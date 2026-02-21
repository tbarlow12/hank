import { readdirSync, copyFileSync, existsSync, mkdirSync } from 'fs'
import { resolve, basename } from 'path'
import { execSync } from 'child_process'
import chalk from 'chalk'
import { PIPELINE_DIR, detectAgents, stageDir } from './config.js'
import { parseWorkItem, updateFrontmatter } from './frontmatter.js'
import { getLockInfo } from './claim.js'
import { STAGES } from './types.js'

export function printStatus() {
  const agents = detectAgents()

  console.log(chalk.bold('\nAgents\n'))
  for (const a of agents) {
    const lock = findAgentLock(a.id)
    const state = lock ? chalk.yellow(`busy: ${lock}`) : chalk.green('free')
    const dirty = isRepoDirtyQuick(a.dir)
    const dirtyTag = dirty ? chalk.red(' [dirty]') : ''
    const role = a.role === 'planner' ? chalk.cyan('planner') : chalk.dim('executor')
    console.log(`  ${a.id.padEnd(10)} ${role.padEnd(20)} ${state}${dirtyTag}`)
  }

  console.log(chalk.bold('\nPipeline\n'))

  let total = 0
  for (const stage of STAGES) {
    const dir = stageDir(stage)
    let count = 0
    try {
      count = readdirSync(dir).filter(f => f.endsWith('.md')).length
    } catch { /* dir doesn't exist */ }

    total += count
    const color = stage === '5-Done' ? chalk.green
      : stage === '4-Failures' ? chalk.red
      : count > 0 ? chalk.yellow : chalk.dim

    console.log(color(`  ${stage.padEnd(15)} ${count} item${count !== 1 ? 's' : ''}`))

    if (count > 0) {
      try {
        const files = readdirSync(dir).filter(f => f.endsWith('.md'))
        for (const file of files) {
          try {
            const { data } = parseWorkItem(resolve(dir, file))
            const status = data.status === 'in_progress' ? chalk.blue('~') : chalk.dim('o')
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
  const src = resolve(process.cwd(), file)
  const ideasDir = stageDir('1-Ideas')
  mkdirSync(ideasDir, { recursive: true })
  const dest = resolve(ideasDir, basename(file))

  if (!existsSync(src)) {
    console.error(chalk.red(`File not found: ${src}`))
    process.exit(1)
  }

  copyFileSync(src, dest)

  // Ensure frontmatter
  try {
    const { data } = parseWorkItem(dest)
    const now = new Date().toISOString()
    const defaults = {
      id: data.id || basename(file, '.md'),
      status: 'pending' as const,
      stage: '1-Ideas',
      attempt: 1,
      created: data.created || now,
      history: data.history || `1-Ideas:${now}`,
      assignee: '',
    }
    updateFrontmatter(dest, { ...defaults, ...data } as any)
  } catch { /* raw markdown is fine, planner handles it */ }

  console.log(chalk.green(`Injected ${basename(file)} → pipeline/1-Ideas/`))
}

function findAgentLock(agentId: string): string | null {
  const locksDir = resolve(PIPELINE_DIR, '..', 'locks')
  if (!existsSync(locksDir)) return null
  try {
    const files = readdirSync(locksDir).filter(f => f.endsWith('.lock'))
    for (const f of files) {
      const info = getLockInfo(f.replace('.lock', ''))
      if (info?.agentId === agentId) return f.replace('.lock', '')
    }
  } catch { /* */ }
  return null
}

function isRepoDirtyQuick(dir: string): boolean {
  try {
    const out = execSync('git status --porcelain', { cwd: dir, encoding: 'utf-8', timeout: 3000 })
    return out.trim().length > 0
  } catch {
    return false
  }
}
