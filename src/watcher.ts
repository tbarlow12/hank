import { readdirSync, existsSync } from 'fs'
import { resolve, basename } from 'path'
import { execSync } from 'child_process'
import chalk from 'chalk'
import { PIPELINE_DIR, POLL_INTERVAL, detectAgents, getPlanner, getExecutors, stageDir } from './config.js'
import { parseWorkItem, updateFrontmatter } from './frontmatter.js'
import { tryClaimFile } from './claim.js'
import { clearStaleLocks } from './claim.js'
import { runAgent } from './runner.js'
import { moveItem } from './mover.js'
import { logStage, logInfo, logError } from './logger.js'
import type { Agent } from './types.js'

let running = true

// Track which agents are busy
const busy = new Map<string, string>() // agentId → workItemFilename

export async function startWatching() {
  const agents = detectAgents()
  const planner = getPlanner(agents)
  const executors = getExecutors(agents)

  if (!planner) {
    logError('No planner agent found (need ~/dev/0/land-catalyst)')
    process.exit(1)
  }
  if (executors.length === 0) {
    logError('No executor agents found (need ~/dev/N/land-catalyst, N>=1)')
    process.exit(1)
  }

  // Ensure pipeline dirs exist
  for (const dir of ['1-Ideas', '2-Plans', '3-Work', '4-Failures', '5-Done']) {
    const d = resolve(PIPELINE_DIR, dir)
    if (!existsSync(d)) {
      const { mkdirSync } = await import('fs')
      mkdirSync(d, { recursive: true })
    }
  }

  // Crash recovery: clear stale locks
  clearStaleLocks()

  logInfo(`Watching pipeline — planner: ${planner.id}, executors: ${executors.map(e => e.id).join(', ')}`)
  logInfo(`Poll interval: ${POLL_INTERVAL / 1000}s`)

  process.on('SIGINT', () => {
    logInfo('\nShutting down...')
    running = false
    process.exit(0)
  })

  while (running) {
    // Phase 1: Ideas → Plan on agent 0
    await pollIdeas(planner)

    // Phase 2: Plans → Execute on first free executor
    await pollPlans(executors)

    // Phase 3: Work → Check PR merge status
    await pollWork()

    await sleep(POLL_INTERVAL)
  }
}

/** Run a single idea through the full pipeline (plan → execute) */
export async function runSingle(filePath: string, planOnly: boolean) {
  const agents = detectAgents()
  const planner = getPlanner(agents)
  const executors = getExecutors(agents)

  if (!planner) { logError('No planner found'); process.exit(1) }

  // Plan phase
  logInfo(`Planning: ${basename(filePath)}`)
  const planResult = await runAgent(filePath, '1-Ideas', planner, 'agents/planner.md')

  if (planResult.directive !== 'PASS' && planResult.directive !== 'SPLIT') {
    logError(`Plan ${planResult.directive}: ${planResult.reason || 'unknown'}`)
    process.exit(1)
  }

  // Save session
  if (planResult.session_id) {
    updateFrontmatter(filePath, { sessions: { '1-Ideas': planResult.session_id } } as any)
  }

  // Append plan output
  const { appendSection } = await import('./frontmatter.js')
  appendSection(filePath, 'Plan', planResult.output)
  updateFrontmatter(filePath, { stage: '2-Plans', status: 'pending' } as any)

  logInfo(`Plan complete: ${planResult.directive}`)

  if (planOnly) return

  // Execute phase
  if (!executors.length) { logError('No executors found'); process.exit(1) }
  const executor = executors[0]

  logInfo(`Executing on ${executor.id}: ${basename(filePath)}`)
  const execResult = await runAgent(filePath, '2-Plans', executor, 'agents/executor.md')

  if (execResult.directive === 'PASS') {
    logInfo(`Done! ${execResult.pr_url ? `PR: ${execResult.pr_url}` : 'Execution complete.'}`)
  } else {
    logError(`Execute ${execResult.directive}: ${execResult.reason || 'unknown'}`)
    process.exit(1)
  }
}

async function pollIdeas(planner: Agent) {
  if (busy.has(planner.id)) return

  const items = getPendingItems('1-Ideas')
  if (items.length === 0) return

  const { file, filePath } = items[0]

  // Check if planner repo is dirty
  if (isRepoDirty(planner.dir)) {
    logStage('1-Ideas', chalk.yellow(`${planner.id} has dirty repo, skipping`))
    return
  }

  const lock = tryClaimFile(file, planner.id)
  if (!lock) return

  updateFrontmatter(filePath, { status: 'in_progress', assignee: planner.id } as any)
  busy.set(planner.id, file)

  logStage('1-Ideas', `${chalk.bold(file)} claimed by ${chalk.blue(planner.id)}`)

  processItem(filePath, file, '1-Ideas', planner, lock, 'agents/planner.md').catch(err => {
    logError(`Planning ${file} failed: ${err.message}`)
    lock.release()
    busy.delete(planner.id)
  })
}

async function pollPlans(executors: Agent[]) {
  const items = getPendingItems('2-Plans')
  if (items.length === 0) return

  for (const { file, filePath } of items) {
    // Find first free executor with clean repo
    const executor = findFreeExecutor(executors)
    if (!executor) break

    const lock = tryClaimFile(file, executor.id)
    if (!lock) continue

    updateFrontmatter(filePath, { status: 'in_progress', assignee: executor.id } as any)
    busy.set(executor.id, file)

    logStage('2-Plans', `${chalk.bold(file)} claimed by ${chalk.blue(executor.id)}`)

    processItem(filePath, file, '2-Plans', executor, lock, 'agents/executor.md').catch(err => {
      logError(`Executing ${file} failed: ${err.message}`)
      lock.release()
      busy.delete(executor.id)
    })
  }
}

async function pollWork() {
  const dir = stageDir('3-Work')
  if (!existsSync(dir)) return

  const files = readdirSync(dir).filter(f => f.endsWith('.md'))
  for (const file of files) {
    const filePath = resolve(dir, file)
    try {
      const { data } = parseWorkItem(filePath)
      if (!data.pr_url) continue

      // Check if PR is merged
      const merged = isPrMerged(data.pr_url)
      if (merged) {
        logStage('3-Work', `${chalk.bold(file)} PR merged!`)
        // Create a dummy lock for mover
        const lock = tryClaimFile(file, 'system')
        if (lock) {
          moveItem(filePath, lock, '3-Work', 'PASS')
        }
      }
    } catch { /* skip */ }
  }
}

async function processItem(
  filePath: string,
  filename: string,
  stage: string,
  agent: Agent,
  lock: any,
  promptFile: string,
) {
  try {
    const result = await runAgent(filePath, stage, agent, promptFile)

    // Save session ID for resume
    if (result.session_id) {
      const { data } = parseWorkItem(filePath)
      const sessions = { ...(data.sessions || {}), [stage]: result.session_id }
      updateFrontmatter(filePath, { sessions } as any)
    }

    // Save PR URL if present
    if (result.pr_url) {
      updateFrontmatter(filePath, { pr_url: result.pr_url } as any)
    }

    logStage(stage, `${filename}: ${chalk.bold(result.directive)}${result.reason ? ` — ${result.reason}` : ''}`)

    moveItem(filePath, lock, stage, result.directive, result.reason, result.output, result.splits)
  } catch (err: any) {
    logError(`Agent error on ${filename}: ${err.message}`)
    moveItem(filePath, lock, stage, 'FAIL', err.message)
  } finally {
    busy.delete(agent.id)
  }
}

function findFreeExecutor(executors: Agent[]): Agent | undefined {
  for (const e of executors) {
    if (busy.has(e.id)) continue
    if (isRepoDirty(e.dir)) {
      logStage('2-Plans', chalk.yellow(`${e.id} has dirty repo, skipping`))
      continue
    }
    return e
  }
  return undefined
}

function getPendingItems(stage: string) {
  const dir = stageDir(stage)
  if (!existsSync(dir)) return []

  const items: { file: string; filePath: string; priority: number; created: string }[] = []
  const files = readdirSync(dir).filter(f => f.endsWith('.md'))

  for (const file of files) {
    const filePath = resolve(dir, file)
    try {
      const { data } = parseWorkItem(filePath)
      if (data.status === 'pending') {
        items.push({ file, filePath, priority: data.priority ?? 10, created: data.created || '' })
      }
    } catch { continue }
  }

  // Sort: priority (lower first), then FIFO (older first)
  items.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority
    return a.created < b.created ? -1 : a.created > b.created ? 1 : 0
  })

  return items
}

function isRepoDirty(dir: string): boolean {
  try {
    const out = execSync('git status --porcelain', { cwd: dir, encoding: 'utf-8', timeout: 5000 })
    return out.trim().length > 0
  } catch {
    return true // assume dirty if we can't check
  }
}

function isPrMerged(prUrl: string): boolean {
  try {
    const out = execSync(`gh pr view "${prUrl}" --json state -q '.state'`, { encoding: 'utf-8', timeout: 10000 })
    return out.trim() === 'MERGED'
  } catch {
    return false
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}
