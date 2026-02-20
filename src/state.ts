import { readdirSync, readFileSync, copyFileSync, renameSync, existsSync, mkdirSync } from 'fs'
import { resolve, basename } from 'path'
import chalk from 'chalk'
import { loadConfig, loadPipeline, getRoot } from './config.js'
import { getAllDirs } from './pipeline.js'
import { parseWorkItem, updateFrontmatter } from './frontmatter.js'
import { getAssignments } from './scheduler.js'
import type { WorkItem, PipelineState, AgentStatus } from './types.js'

export function getPipelineState(): PipelineState {
  const root = getRoot()
  const pipeline = loadPipeline()
  const config = loadConfig()
  const dirs = getAllDirs(pipeline)

  const stages: Record<string, WorkItem[]> = {}
  for (const dir of dirs) {
    const dirPath = resolve(root, 'pipeline', dir)
    stages[dir] = []
    try {
      const files = readdirSync(dirPath).filter(f => f.endsWith('.md'))
      for (const file of files) {
        try {
          const { data } = parseWorkItem(resolve(dirPath, file))
          stages[dir].push(data)
        } catch { /* skip unparseable */ }
      }
    } catch { /* dir doesn't exist */ }
  }

  const assignments = getAssignments()
  const agents: AgentStatus[] = Object.keys(config.agents).map(id => ({
    id,
    busy: assignments.has(id),
    currentItem: assignments.get(id),
  }))

  return { stages, agents }
}

export function printStatus() {
  const root = getRoot()
  const pipeline = loadPipeline()
  const dirs = getAllDirs(pipeline)

  console.log(chalk.bold('\nPipeline Status\n'))

  let total = 0
  for (const dir of dirs) {
    const dirPath = resolve(root, 'pipeline', dir)
    let count = 0
    try {
      count = readdirSync(dirPath).filter(f => f.endsWith('.md')).length
    } catch { /* dir doesn't exist */ }

    total += count
    const color = dir === 'done' ? chalk.green : dir === 'failed' ? chalk.red : count > 0 ? chalk.yellow : chalk.dim
    console.log(color(`  ${dir.padEnd(15)} ${count} item${count !== 1 ? 's' : ''}`))

    // Show individual items
    if (count > 0) {
      try {
        const files = readdirSync(dirPath).filter(f => f.endsWith('.md'))
        for (const file of files) {
          try {
            const { data } = parseWorkItem(resolve(dirPath, file))
            const status = data.status === 'in_progress' ? chalk.blue('⟳') : chalk.dim('○')
            const assignee = data.assignee ? chalk.dim(` [${data.assignee}]`) : ''
            console.log(`    ${status} ${data.title || file}${assignee}`)
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
    }
  }

  console.log(chalk.dim(`\n  Total: ${total} items\n`))
}

export function injectItem(file: string) {
  const root = getRoot()
  const src = resolve(process.cwd(), file)
  const draftsDir = resolve(root, 'pipeline/drafts')
  mkdirSync(draftsDir, { recursive: true })
  const dest = resolve(draftsDir, basename(file))

  if (!existsSync(src)) {
    console.error(chalk.red(`File not found: ${src}`))
    process.exit(1)
  }

  copyFileSync(src, dest)

  // Ensure frontmatter has required fields
  try {
    const { data } = parseWorkItem(dest)
    const now = new Date().toISOString()
    const defaults: Partial<WorkItem> = {
      id: data.id || basename(file, '.md'),
      status: 'pending',
      stage: 'drafts',
      attempt: 1,
      source: data.source || 'manual',
      created: data.created || now,
      history: data.history || `drafts:${now}`,
      assignee: '',
    }
    updateFrontmatter(dest, { ...defaults, ...data } as any)
  } catch {
    // Not a valid frontmatter file — that's OK, planner will handle it
  }

  console.log(chalk.green(`Injected ${basename(file)} → pipeline/drafts/`))
}

export function tailLogs(target?: string) {
  const root = getRoot()

  if (!target) {
    // Show all recent logs
    const stageDir = resolve(root, 'logs/stages')
    try {
      const files = readdirSync(stageDir)
      for (const f of files) {
        console.log(chalk.bold(`\n--- ${f} ---`))
        const content = readFileSync(resolve(stageDir, f), 'utf-8')
        const lines = content.split('\n').slice(-20)
        console.log(lines.join('\n'))
      }
    } catch {
      console.log(chalk.dim('No logs yet.'))
    }
    return
  }

  // Try stage log first
  const stageLog = resolve(root, 'logs/stages', `${target}.log`)
  if (existsSync(stageLog)) {
    const content = readFileSync(stageLog, 'utf-8')
    const lines = content.split('\n').slice(-50)
    console.log(lines.join('\n'))
    return
  }

  // Try item log
  const itemLog = resolve(root, 'logs/items', `${target}.log`)
  if (existsSync(itemLog)) {
    const content = readFileSync(itemLog, 'utf-8')
    const lines = content.split('\n').slice(-50)
    console.log(lines.join('\n'))
    return
  }

  console.log(chalk.dim(`No logs found for: ${target}`))
}

export function retryItem(itemId: string) {
  const root = getRoot()
  const failedDir = resolve(root, 'pipeline/failed')

  let found: string | null = null
  try {
    const files = readdirSync(failedDir).filter(f => f.endsWith('.md'))
    for (const f of files) {
      if (f.includes(itemId)) {
        found = f
        break
      }
    }
  } catch { /* */ }

  if (!found) {
    console.error(chalk.red(`No failed item matching: ${itemId}`))
    process.exit(1)
  }

  const filePath = resolve(failedDir, found)
  const { data } = parseWorkItem(filePath)

  // Parse history to find last non-failed stage
  const historyParts = (data.history || '').split(',').map(s => s.trim())
  let targetStage = 'drafts' // default fallback
  for (const part of historyParts.reverse()) {
    const stage = part.split('→')[0].split(':')[0]
    if (stage && stage !== 'failed') {
      targetStage = stage
      break
    }
  }

  // Move back
  updateFrontmatter(filePath, { status: 'pending', stage: targetStage, assignee: '' } as any)
  const targetPath = resolve(root, 'pipeline', targetStage, found)
  renameSync(filePath, targetPath)

  console.log(chalk.green(`Retrying ${found} → ${targetStage}/`))
}
