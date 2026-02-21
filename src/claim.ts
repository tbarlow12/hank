import { writeFileSync, unlinkSync, existsSync, readFileSync, mkdirSync, readdirSync } from 'fs'
import { resolve } from 'path'
import { LOCKS_DIR } from './config.js'

export interface Lock {
  file: string
  lockPath: string
  agentId: string
  release: () => void
}

export function tryClaimFile(filename: string, agentId: string): Lock | null {
  mkdirSync(LOCKS_DIR, { recursive: true })
  const lockPath = resolve(LOCKS_DIR, `${filename}.lock`)

  if (existsSync(lockPath)) {
    // Check for stale lock (>60 min)
    try {
      const info = JSON.parse(readFileSync(lockPath, 'utf-8'))
      const age = Date.now() - new Date(info.ts).getTime()
      if (age > 60 * 60 * 1000) {
        unlinkSync(lockPath) // stale, reclaim
      } else {
        return null
      }
    } catch {
      return null
    }
  }

  try {
    writeFileSync(lockPath, JSON.stringify({ agentId, ts: new Date().toISOString(), file: filename }), { flag: 'wx' })
  } catch {
    return null
  }

  return {
    file: filename,
    lockPath,
    agentId,
    release: () => releaseLock(lockPath),
  }
}

export function releaseLock(lockPath: string) {
  try { unlinkSync(lockPath) } catch { /* already released */ }
}

export function isLocked(filename: string): boolean {
  return existsSync(resolve(LOCKS_DIR, `${filename}.lock`))
}

export function getLockInfo(filename: string): { agentId: string; ts: string } | null {
  const lockPath = resolve(LOCKS_DIR, `${filename}.lock`)
  if (!existsSync(lockPath)) return null
  try {
    return JSON.parse(readFileSync(lockPath, 'utf-8'))
  } catch {
    return null
  }
}

/** Clear all stale locks on startup (crash recovery) */
export function clearStaleLocks() {
  if (!existsSync(LOCKS_DIR)) return
  const files = readdirSync(LOCKS_DIR).filter(f => f.endsWith('.lock'))
  let cleared = 0
  for (const f of files) {
    const lockPath = resolve(LOCKS_DIR, f)
    try {
      const info = JSON.parse(readFileSync(lockPath, 'utf-8'))
      const age = Date.now() - new Date(info.ts).getTime()
      if (age > 60 * 60 * 1000) {
        unlinkSync(lockPath)
        cleared++
      }
    } catch {
      unlinkSync(lockPath)
      cleared++
    }
  }
  if (cleared > 0) console.log(`Cleared ${cleared} stale lock(s)`)
}
