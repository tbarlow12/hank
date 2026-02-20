import type { HankConfig, PipelineConfig, AgentConfig } from './types.js'

// Track which agents are currently busy
const assignments = new Map<string, string>() // agentId → workItemFilename

// Round-robin index per pool
const poolIndex = new Map<string, number>()

export function findAvailableAgent(
  stageName: string,
  pipeline: PipelineConfig,
  config: HankConfig,
): AgentConfig | null {
  const stage = pipeline.stages[stageName]
  if (!stage) return null

  const pool = config.pools[stage.pool]
  if (!pool) return null

  const agents = pool.agents
  const len = agents.length
  if (len === 0) return null

  // Start scanning from where we left off (round-robin)
  const offset = poolIndex.get(stage.pool) || 0

  for (let i = 0; i < len; i++) {
    const idx = (offset + i) % len
    const agentId = agents[idx]

    if (assignments.has(agentId)) continue

    const agent = config.agents[agentId]
    if (!agent) continue

    if (pool.requires) {
      const hasAll = pool.requires.every(cap => agent.capabilities.includes(cap))
      if (!hasAll) continue
    }

    // Advance past this agent for next call
    poolIndex.set(stage.pool, (idx + 1) % len)
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
