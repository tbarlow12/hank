import { mkdirSync, existsSync } from 'fs'
import { resolve } from 'path'
import { execSync } from 'child_process'
import chalk from 'chalk'
import { loadConfig, loadPipeline, validatePipeline, getRoot } from './config.js'
import { logInfo, logError } from './logger.js'

export async function init() {
  const config = loadConfig()
  const pipeline = loadPipeline()
  validatePipeline(pipeline, config)

  const root = getRoot()

  // Create pipeline directories
  logInfo('Creating pipeline directories...')
  const stageDirs = [...Object.keys(pipeline.stages), 'done', 'failed']
  for (const stage of stageDirs) {
    const dir = resolve(root, 'pipeline', stage)
    mkdirSync(dir, { recursive: true })
    console.log(chalk.dim(`  ${dir}`))
  }

  // Create locks + logs dirs
  for (const d of ['locks', 'logs/stages', 'logs/items']) {
    mkdirSync(resolve(root, d), { recursive: true })
  }

  // Create agents directory
  logInfo('Setting up agents...')
  for (const [id, agent] of Object.entries(config.agents)) {
    console.log(chalk.bold(`\n  Agent: ${id}`))
    console.log(chalk.dim(`  Path: ${agent.path}`))
    console.log(chalk.dim(`  Capabilities: ${agent.capabilities.join(', ')}`))

    // Create parent dir
    const parentDir = resolve(agent.path, '..')
    mkdirSync(parentDir, { recursive: true })

    // Clone if not exists
    if (!existsSync(agent.path)) {
      logInfo(`  Cloning ${config.project.repo} → ${agent.path}`)
      try {
        execSync(`git clone ${config.project.repo} ${agent.path}`, { stdio: 'pipe' })
        console.log(chalk.green(`  ✓ Cloned`))
      } catch (e: any) {
        logError(`  Clone failed for ${id}: ${e.message}`)
        continue
      }
    } else {
      console.log(chalk.dim(`  ✓ Already cloned`))
    }

    // Run global setup commands
    if (config.setup) {
      for (const cmd of config.setup) {
        runSetup(agent.path, cmd, id)
      }
    }

    // Run agent-specific setup
    if (agent.setup) {
      for (const cmd of agent.setup) {
        runSetup(agent.path, cmd, id)
      }
    }
  }

  // Validate pools
  logInfo('\nValidating pools...')
  for (const [name, pool] of Object.entries(config.pools)) {
    const agentList = pool.agents.join(', ')
    const reqs = pool.requires ? ` (requires: ${pool.requires.join(', ')})` : ''
    console.log(chalk.dim(`  ${name}: [${agentList}]${reqs}`))
  }

  logInfo('\nInit complete.')
}

function runSetup(cwd: string, cmd: string, agentId: string) {
  console.log(chalk.dim(`  Running: ${cmd}`))
  try {
    execSync(cmd, { cwd, stdio: 'pipe', timeout: 120_000 })
    console.log(chalk.green(`  ✓ ${cmd}`))
  } catch (e: any) {
    logError(`  Setup command failed for ${agentId}: ${cmd}\n  ${e.message}`)
  }
}
