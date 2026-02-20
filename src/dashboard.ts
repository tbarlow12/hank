import { createServer } from 'http'
import { readFileSync, readdirSync, existsSync } from 'fs'
import { resolve } from 'path'
import chalk from 'chalk'
import { getRoot, loadPipeline, loadConfig } from './config.js'
import { getAllDirs } from './pipeline.js'
import { parseWorkItem } from './frontmatter.js'
import { logInfo } from './logger.js'

interface DashboardState {
  stages: Record<string, any[]>
  agents: any[]
  metrics: { total: number; done: number; failed: number; inProgress: number }
  timestamp: string
}

function getState(): DashboardState {
  const root = getRoot()
  const pipeline = loadPipeline()
  const config = loadConfig()
  const dirs = getAllDirs(pipeline)

  const stages: Record<string, any[]> = {}
  let total = 0, done = 0, failed = 0, inProgress = 0

  for (const dir of dirs) {
    const dirPath = resolve(root, 'pipeline', dir)
    stages[dir] = []
    try {
      const files = readdirSync(dirPath).filter(f => f.endsWith('.md'))
      for (const file of files) {
        try {
          const { data } = parseWorkItem(resolve(dirPath, file))
          stages[dir].push({ ...data, _file: file })
          total++
          if (dir === 'done') done++
          else if (dir === 'failed') failed++
          else if (data.status === 'in_progress') inProgress++
        } catch { /* skip */ }
      }
    } catch { /* dir doesn't exist */ }
  }

  // Agent status from lock files
  const agents = Object.entries(config.agents).map(([id, agent]) => {
    const lockDir = resolve(root, 'locks')
    let busy = false
    let currentItem: string | undefined
    try {
      const locks = readdirSync(lockDir).filter(f => f.endsWith('.lock'))
      for (const lock of locks) {
        try {
          const info = JSON.parse(readFileSync(resolve(lockDir, lock), 'utf-8'))
          if (info.agentId === id) {
            busy = true
            currentItem = info.file
          }
        } catch { /* skip */ }
      }
    } catch { /* no locks dir */ }

    return { id, path: agent.path, capabilities: agent.capabilities, busy, currentItem }
  })

  return {
    stages,
    agents,
    metrics: { total, done, failed, inProgress },
    timestamp: new Date().toISOString(),
  }
}

export function startDashboard(port: number = 4800) {
  const root = getRoot()
  const htmlPath = resolve(import.meta.dirname, 'dashboard.html')

  const sseClients = new Set<any>()

  // Push state updates every 2s
  setInterval(() => {
    const state = getState()
    const data = `data: ${JSON.stringify(state)}\n\n`
    for (const res of sseClients) {
      try { res.write(data) } catch { sseClients.delete(res) }
    }
  }, 2000)

  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', `http://localhost:${port}`)

    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(readFileSync(htmlPath, 'utf-8'))
      return
    }

    if (url.pathname === '/api/state') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(getState()))
      return
    }

    if (url.pathname === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      })
      sseClients.add(res)
      req.on('close', () => sseClients.delete(res))

      // Send initial state
      const state = getState()
      res.write(`data: ${JSON.stringify(state)}\n\n`)
      return
    }

    if (url.pathname.startsWith('/api/items/')) {
      const id = url.pathname.split('/api/items/')[1]
      const pipeline = loadPipeline()
      const dirs = getAllDirs(pipeline)

      for (const dir of dirs) {
        const dirPath = resolve(root, 'pipeline', dir)
        try {
          const files = readdirSync(dirPath).filter(f => f.endsWith('.md'))
          for (const file of files) {
            if (file.includes(id)) {
              const content = readFileSync(resolve(dirPath, file), 'utf-8')
              // Also get logs
              let logs = ''
              const logPath = resolve(root, 'logs/items', `${id}.log`)
              if (existsSync(logPath)) {
                logs = readFileSync(logPath, 'utf-8')
              }
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ content, logs, stage: dir }))
              return
            }
          }
        } catch { /* skip */ }
      }

      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Not found' }))
      return
    }

    res.writeHead(404)
    res.end('Not found')
  })

  server.listen(port, () => {
    logInfo(`Dashboard running at ${chalk.bold(`http://localhost:${port}`)}`)
    logInfo('Press Ctrl+C to stop')
  })
}
