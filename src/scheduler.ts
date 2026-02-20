import type { HankConfig, PipelineConfig, AgentConfig } from './types.js'
import { isLocked } from './claim.js'

// Track which agents are currently busy
const assignments = new Map<string, string>() // agentId → workItemFilename

export function findAvailableAgent(
  stageName: string,
  pipeline: PipelineConfig,
  config: HankConfig,
): AgentConfig | null {
  const stage = pipeline.stages[stageName]
  if (!stage) return null

  const pool = config.pools[stage.pool]
  if (!pool) return null

  for (const agentId of pool.agents) {
    if (assignments.has(agentId)) continue

    const agent = config.agents[agentId]
    if (!agent) continue

    // Check capability requirements
    if (pool.requires) {
      const hasAll = pool.requires.every(cap => agent.capabilities.includes(cap))
      if (!hasAll) continue
    }

    return agent
  }

  return null
}

export function assignAgent(agentId: string, workItemFilename: string) {
  assignments.set(agentId, workItemFilename)
}

export function releaseAgent(agentId: string) {
  assignments.delete(agentId)
}

export function getAssignments(): Map<string, string> {
  return new Map(assignments)
}

export function isAgentBusy(agentId: string): boolean {
  return assignments.has(agentId)
}
