import { mkdirSync, existsSync, copyFileSync } from 'fs'
import { resolve } from 'path'
import { execSync } from 'child_process'
import chalk from 'chalk'
import { configExists, loadConfig, loadPipeline, validatePipeline, getRoot } from './config.js'
import { scaffoldProjectConfig } from './project-config.js'
import { logInfo, logError } from './logger.js'
import { runWizard } from './wizard.js'

export async function init() {
  // If no config exists, run the interactive wizard first
  if (!configExists()) {
    logInfo('No hank.yml found — starting setup wizard.')
    const proceed = await runWizard()
    if (!proceed) return
  }

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

  // Clone repos for each agent
  logInfo('Setting up agents...')
  for (const [id, agent] of Object.entries(config.agents)) {
    console.log(chalk.bold(`\n  Agent: ${id}`))
    console.log(chalk.dim(`  Base: ${agent.base_dir}`))
    console.log(chalk.dim(`  Capabilities: ${agent.capabilities.join(', ') || 'none'}`))

    mkdirSync(agent.base_dir, { recursive: true })

    // Clone each project
    for (const [projName, projConfig] of Object.entries(config.projects)) {
      const clonePath = agent.projects[projName]
      console.log(chalk.dim(`\n    Project: ${projName}`))

      if (!existsSync(clonePath)) {
        logInfo(`    Cloning ${projConfig.repo} → ${clonePath}`)
        try {
          execSync(`git clone ${projConfig.repo} "${clonePath}"`, { stdio: 'pipe' })
          console.log(chalk.green(`    ✓ Cloned`))
        } catch (e: any) {
          logError(`    Clone failed for ${id}/${projName}: ${e.message}`)
          continue
        }
      } else {
        console.log(chalk.dim(`    ✓ Already cloned`))
      }

      // Copy staged .hank.yml if it exists (from wizard), otherwise scaffold one
      const stagedConfig = resolve(root, '.hank-staging', `${projName}.hank.yml`)
      const targetConfig = resolve(clonePath, '.hank.yml')
      if (existsSync(stagedConfig) && !existsSync(targetConfig)) {
        copyFileSync(stagedConfig, targetConfig)
        console.log(chalk.green(`    ✓ Copied .hank.yml`))
      } else if (!existsSync(targetConfig)) {
        scaffoldProjectConfig(clonePath, projName)
        console.log(chalk.green(`    ✓ Scaffolded .hank.yml`))
      }

      // Run project-level setup commands
      if (projConfig.setup) {
        for (const cmd of projConfig.setup) {
          runSetup(clonePath, cmd, `${id}/${projName}`)
        }
      }

      // Run global setup commands
      if (config.setup) {
        for (const cmd of config.setup) {
          runSetup(clonePath, cmd, `${id}/${projName}`)
        }
      }
    }

    // Run agent-specific setup
    if (agent.setup) {
      // Agent setup runs in the first project directory (or base_dir)
      const firstProject = Object.keys(config.projects)[0]
      const setupDir = firstProject ? agent.projects[firstProject] : agent.base_dir
      for (const cmd of agent.setup) {
        runSetup(setupDir, cmd, id)
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

function runSetup(cwd: string, cmd: string, label: string) {
  console.log(chalk.dim(`    Running: ${cmd}`))
  try {
    execSync(cmd, { cwd, stdio: 'pipe', timeout: 120_000 })
    console.log(chalk.green(`    ✓ ${cmd}`))
  } catch (e: any) {
    logError(`    Setup failed for ${label}: ${cmd}\n    ${e.message}`)
  }
}
