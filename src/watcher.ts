import { readdirSync } from 'fs'
import { resolve, basename } from 'path'
import chalk from 'chalk'
import { loadConfig, loadPipeline, validatePipeline, getRoot } from './config.js'
import { getStageNames } from './pipeline.js'
import { parseWorkItem } from './frontmatter.js'
import { tryClaimFile } from './claim.js'
import { findAvailableAgent, assignAgent, releaseAgent } from './scheduler.js'
import { runAgent } from './runner.js'
import { moveItem } from './mover.js'
import { logStage, logInfo, logError } from './logger.js'

let running = true

export async function startWatchers(targetStage?: string) {
  const config = loadConfig()
  const pipeline = loadPipeline()
  validatePipeline(pipeline, config)

  const stages = targetStage ? [targetStage] : getStageNames(pipeline)
  const pollInterval = (config.defaults.poll_interval ?? 5) * 1000

  logInfo(`Starting watchers for: ${stages.join(', ')}`)
  logInfo(`Poll interval: ${pollInterval / 1000}s`)

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    logInfo('\nShutting down watchers...')
    running = false
    process.exit(0)
  })

  // Poll loop
  while (running) {
    for (const stage of stages) {
      await pollStage(stage, pipeline, config)
    }
    await sleep(pollInterval)
  }
}

async function pollStage(
  stageName: string,
  pipeline: any,
  config: any,
) {
  const root = getRoot()
  const stageDir = resolve(root, 'pipeline', stageName)

  let files: string[]
  try {
    files = readdirSync(stageDir).filter(f => f.endsWith('.md'))
  } catch {
    return // dir doesn't exist yet
  }

  for (const file of files) {
    const filePath = resolve(stageDir, file)

    // Parse and check status
    let item
    try {
      item = parseWorkItem(filePath)
    } catch {
      continue
    }

    if (item.data.status !== 'pending') continue

    // Try to find an available agent
    const agent = findAvailableAgent(stageName, pipeline, config)
    if (!agent) continue

    // Claim the file
    const lock = tryClaimFile(file, agent.id)
    if (!lock) continue

    // Mark as in_progress
    const { updateFrontmatter } = await import('./frontmatter.js')
    updateFrontmatter(filePath, { status: 'in_progress', assignee: agent.id } as any)
    assignAgent(agent.id, file)

    logStage(stageName, `${chalk.bold(file)} claimed by ${chalk.blue(agent.id)}`)

    // Run agent (async — don't block polling)
    processItem(filePath, file, stageName, agent, lock, pipeline, config).catch(err => {
      logError(`Processing ${file} failed: ${err.message}`)
      lock.release()
      releaseAgent(agent.id)
    })
  }
}

async function processItem(
  filePath: string,
  filename: string,
  stageName: string,
  agent: any,
  lock: any,
  pipeline: any,
  config: any,
) {
  const stageConfig = pipeline.stages[stageName]

  try {
    const result = await runAgent(filePath, stageName, stageConfig, agent, config)

    logStage(stageName, `${filename}: ${chalk.bold(result.directive)}${result.reason ? ` — ${result.reason}` : ''}`)

    // Move file to next stage (pass splits for SPLIT directive)
    moveItem(filePath, lock, pipeline, stageName, result.directive, result.reason, result.output, result.splits)
  } catch (err: any) {
    logError(`Agent error on ${filename}: ${err.message}`)
    moveItem(filePath, lock, pipeline, stageName, 'FAIL', err.message)
  } finally {
    releaseAgent(agent.id)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}
