import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import yaml from 'js-yaml'
import type { HankConfig, PipelineConfig, AgentConfig } from './types.js'

const ROOT = resolve(import.meta.dirname, '..')

function expandHome(p: string): string {
  if (p.startsWith('~')) return p.replace(/^~/, process.env.HOME || '~')
  if (p.startsWith('/')) return p
  // Relative paths resolve against hank project root
  return resolve(ROOT, p)
}

function loadYaml<T>(file: string): T {
  const raw = readFileSync(resolve(ROOT, file), 'utf-8')
  return yaml.load(raw) as T
}

export function configExists(): boolean {
  return existsSync(resolve(ROOT, 'hank.yml'))
}

export function loadConfig(): HankConfig {
  const raw = loadYaml<any>('hank.yml')

  const baseDir = expandHome(raw.base_dir || '.hank/agents')
  const projectNames = Object.keys(raw.projects || {})

  // Normalize agents: compute clone paths per project
  const agents: Record<string, AgentConfig> = {}
  for (const [id, cfg] of Object.entries(raw.agents as Record<string, any>)) {
    const agentBase = expandHome(cfg.base_dir || `${baseDir}/${id}`)
    const projects: Record<string, string> = {}
    for (const projName of projectNames) {
      projects[projName] = resolve(agentBase, projName)
    }

    agents[id] = {
      id,
      base_dir: agentBase,
      capabilities: cfg.capabilities || [],
      setup: cfg.setup,
      projects,
    }
  }

  // Normalize projects
  const projects: Record<string, any> = {}
  for (const [name, proj] of Object.entries(raw.projects as Record<string, any>)) {
    projects[name] = {
      name,
      ...proj,
    }
  }

  const config: HankConfig = {
    projects,
    base_dir: baseDir,
    defaults: raw.defaults,
    agents,
    pools: raw.pools,
    cli: raw.cli,
    setup: raw.setup,
    fallback_order: raw.fallback_order,
  }

  validateConfig(config)
  return config
}

export function loadPipeline(): PipelineConfig {
  const raw = loadYaml<any>('pipeline.yml')
  const pipeline: PipelineConfig = { stages: raw.stages, max_attempts: raw.max_attempts ?? 3 }
  return pipeline
}

function validateConfig(config: HankConfig) {
  const agentIds = new Set(Object.keys(config.agents))

  for (const [name, pool] of Object.entries(config.pools)) {
    for (const agentId of pool.agents) {
      if (!agentIds.has(agentId)) {
        throw new Error(`Pool "${name}" references unknown agent "${agentId}"`)
      }
    }
    if (pool.requires) {
      for (const agentId of pool.agents) {
        const agent = config.agents[agentId]
        for (const cap of pool.requires) {
          if (!agent.capabilities.includes(cap)) {
            throw new Error(`Pool "${name}" requires "${cap}" but agent "${agentId}" lacks it`)
          }
        }
      }
    }
  }

  if (Object.keys(config.projects).length === 0) {
    throw new Error('No projects configured. Run `hank init` to set up.')
  }
}

export function validatePipeline(pipeline: PipelineConfig, config: HankConfig) {
  const poolNames = new Set(Object.keys(config.pools))
  const stageNames = new Set(Object.keys(pipeline.stages))
  stageNames.add('done')
  stageNames.add('failed')

  for (const [name, stage] of Object.entries(pipeline.stages)) {
    if (!poolNames.has(stage.pool)) {
      throw new Error(`Stage "${name}" references unknown pool "${stage.pool}"`)
    }
    for (const [directive, target] of Object.entries(stage.transitions)) {
      if (!stageNames.has(target)) {
        throw new Error(`Stage "${name}" transition "${directive}" targets unknown stage "${target}"`)
      }
    }
  }
}

/** Resolve which directory an agent should work in for a given project */
export function getAgentProjectPath(agent: AgentConfig, projectName: string): string {
  const p = agent.projects[projectName]
  if (!p) throw new Error(`Agent "${agent.id}" has no clone for project "${projectName}"`)
  return p
}

/** Get the first (or only) project name — convenience for single-project setups */
export function getDefaultProject(config: HankConfig): string {
  const names = Object.keys(config.projects)
  if (names.length === 0) throw new Error('No projects configured')
  return names[0]
}

export function getRoot(): string {
  return ROOT
}
