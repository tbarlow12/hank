import { existsSync } from 'fs'
import { resolve } from 'path'
import type { Agent } from './types.js'

export const ROOT = resolve(import.meta.dirname, '..')
export const PIPELINE_DIR = resolve(ROOT, 'pipeline')
export const LOCKS_DIR = resolve(ROOT, 'locks')
export const LOGS_DIR = resolve(ROOT, 'logs')

export const POLL_INTERVAL = 5_000 // 5s
export const MAX_ATTEMPTS = 3
export const VAULT_PATH = resolve(process.env.HOME || '~', 'Documents/Personal Vault/Projects/Land Catalyst')

export const PLANNER_MODEL = 'opus'
export const EXECUTOR_MODEL = 'sonnet'

const REPO_NAME = 'land-catalyst'

/** Auto-detect agents from ~/dev/N/land-catalyst directories */
export function detectAgents(): Agent[] {
  const home = process.env.HOME || '~'
  const agents: Agent[] = []

  for (let n = 0; n <= 20; n++) {
    const dir = resolve(home, `dev/${n}/${REPO_NAME}`)
    if (!existsSync(dir)) continue
    agents.push({
      id: `agent-${n}`,
      dir,
      role: n === 0 ? 'planner' : 'executor',
    })
  }

  return agents
}

export function getPlanner(agents: Agent[]): Agent | undefined {
  return agents.find(a => a.role === 'planner')
}

export function getExecutors(agents: Agent[]): Agent[] {
  return agents.filter(a => a.role === 'executor')
}

export function stageDir(stage: string): string {
  return resolve(PIPELINE_DIR, stage)
}
