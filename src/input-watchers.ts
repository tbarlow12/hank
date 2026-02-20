import { spawn, ChildProcess } from 'child_process'
import { writeFileSync, mkdirSync } from 'fs'
import { resolve } from 'path'
import { getRoot } from './config.js'
import { logInfo, logError } from './logger.js'
import type { InputWatcherConfig, HankConfig } from './types.js'

interface RunningWatcher {
  name: string
  proc: ChildProcess
  timer?: ReturnType<typeof setInterval>
}

const watchers: RunningWatcher[] = []

export function startInputWatchers(config: HankConfig) {
  const inputs = config.inputs?.filter(w => w.enabled !== false) || []
  if (!inputs.length) return

  logInfo(`Starting ${inputs.length} input watcher(s): ${inputs.map(w => w.name).join(', ')}`)

  for (const watcher of inputs) {
    if (watcher.interval && watcher.interval > 0) {
      // Interval mode: re-run command every N seconds
      runWatcher(watcher, config)
      const timer = setInterval(() => runWatcher(watcher, config), watcher.interval * 1000)
      watchers.push({ name: watcher.name, proc: null as any, timer })
    } else {
      // Long-running mode: command stays alive, emits work items on stdout
      const proc = spawnLongRunning(watcher, config)
      watchers.push({ name: watcher.name, proc })
    }
  }
}

export function stopInputWatchers() {
  for (const w of watchers) {
    if (w.timer) clearInterval(w.timer)
    if (w.proc && !w.proc.killed) w.proc.kill()
  }
  watchers.length = 0
}

/** Run a watcher command once, capture stdout, create work items from output. */
function runWatcher(watcher: InputWatcherConfig, config: HankConfig) {
  const cwd = resolveWatcherCwd(watcher, config)
  const env = { ...process.env, ...watcher.env }

  const proc = spawn(watcher.command, watcher.args || [], {
    cwd, env, shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let stdout = ''
  let stderr = ''
  proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
  proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })

  proc.on('close', (code) => {
    if (code !== 0 && stderr) {
      logError(`Watcher "${watcher.name}" exited ${code}: ${stderr.slice(0, 300)}`)
      return
    }
    const items = parseWatcherOutput(stdout)
    for (const item of items) {
      createWorkItem(item, watcher, config)
    }
  })

  proc.on('error', (err) => {
    logError(`Watcher "${watcher.name}" spawn error: ${err.message}`)
  })
}

/** Spawn a long-running watcher, processing output line-by-line. */
function spawnLongRunning(watcher: InputWatcherConfig, config: HankConfig): ChildProcess {
  const cwd = resolveWatcherCwd(watcher, config)
  const env = { ...process.env, ...watcher.env }

  const proc = spawn(watcher.command, watcher.args || [], {
    cwd, env, shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let buffer = ''
  proc.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString()
    // Process complete lines
    const lines = buffer.split('\n')
    buffer = lines.pop() || '' // keep incomplete last line in buffer
    for (const line of lines) {
      if (!line.trim()) continue
      const items = parseWatcherOutput(line)
      for (const item of items) {
        createWorkItem(item, watcher, config)
      }
    }
  })

  proc.stderr.on('data', (chunk: Buffer) => {
    logError(`Watcher "${watcher.name}" stderr: ${chunk.toString().trim()}`)
  })

  proc.on('close', (code) => {
    logInfo(`Watcher "${watcher.name}" exited with code ${code}`)
  })

  proc.on('error', (err) => {
    logError(`Watcher "${watcher.name}" spawn error: ${err.message}`)
  })

  return proc
}

interface WatcherItem {
  title: string
  body: string
}

/**
 * Parse watcher output into work items.
 * Supports two formats:
 *
 * 1. JSON: {"title": "...", "body": "..."}  (one per line)
 * 2. Simple: entire output is one work item (title = first line, body = rest)
 */
function parseWatcherOutput(output: string): WatcherItem[] {
  const trimmed = output.trim()
  if (!trimmed) return []

  const items: WatcherItem[] = []

  // Try JSON lines first
  const lines = trimmed.split('\n')
  let allJson = true
  for (const line of lines) {
    const l = line.trim()
    if (!l) continue
    try {
      const obj = JSON.parse(l)
      if (obj.title) {
        items.push({ title: obj.title, body: obj.body || '' })
      }
    } catch {
      allJson = false
      break
    }
  }

  if (allJson && items.length > 0) return items

  // Fallback: treat entire output as one item
  const firstLine = lines[0].trim()
  const rest = lines.slice(1).join('\n').trim()
  if (firstLine) {
    return [{ title: firstLine, body: rest }]
  }

  return []
}

function createWorkItem(item: WatcherItem, watcher: InputWatcherConfig, config: HankConfig) {
  const root = getRoot()
  const draftsDir = resolve(root, 'pipeline', 'drafts')
  mkdirSync(draftsDir, { recursive: true })

  const now = new Date()
  const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const slug = item.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50).replace(/-$/, '')
  const id = `${ts}-${slug}`
  const branch = `${config.projects[watcher.project]?.branch_prefix || 'hank/'}${slug}`

  const content = `---
id: ${id}
title: "${item.title.replace(/"/g, '\\"')}"
project: ${watcher.project}
source: watcher:${watcher.name}
created: ${now.toISOString()}
branch: ${branch}
status: pending
stage: drafts
attempt: 1
history: "drafts:${now.toISOString()}"
assignee:
---

${item.body}
`

  const filePath = resolve(draftsDir, `${id}.md`)
  writeFileSync(filePath, content)
  logInfo(`Watcher "${watcher.name}" created work item: ${id}`)
}

function resolveWatcherCwd(watcher: InputWatcherConfig, config: HankConfig): string {
  if (watcher.cwd) return resolve(watcher.cwd)
  // Default: first agent's clone of the watcher's target project
  const agents = Object.values(config.agents)
  if (agents.length > 0 && agents[0].projects[watcher.project]) {
    return agents[0].projects[watcher.project]
  }
  return getRoot()
}
