import { readFileSync } from 'fs'
import { resolve } from 'path'
import yaml from 'js-yaml'
import type { HenryConfig, PipelineConfig, AgentConfig } from './types.js'

const ROOT = resolve(import.meta.dirname, '..')

function expandHome(p: string): string {
  return p.replace(/^~/, process.env.HOME || '~')
}

function loadYaml<T>(file: string): T {
  const raw = readFileSync(resolve(ROOT, file), 'utf-8')
  return yaml.load(raw) as T
}

export function loadConfig(): HenryConfig {
  const raw = loadYaml<any>('henry.yml')

  // Normalize agents: inject id, expand paths
  const agents: Record<string, AgentConfig> = {}
  for (const [id, cfg] of Object.entries(raw.agents as Record<string, any>)) {
    agents[id] = { id, ...cfg, path: expandHome(cfg.path) }
  }

  const config: HenryConfig = {
    project: { ...raw.project, base_dir: expandHome(raw.project.base_dir) },
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

function validateConfig(config: HenryConfig) {
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
}

export function validatePipeline(pipeline: PipelineConfig, config: HenryConfig) {
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

export function getRoot(): string {
  return ROOT
}
