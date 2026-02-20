import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync } from 'fs'
import { resolve } from 'path'
import { getRoot } from './config.js'

const locksDir = () => resolve(getRoot(), 'locks')

export interface Lock {
  file: string
  lockPath: string
  agentId: string
  release: () => void
}

export function tryClaimFile(filename: string, agentId: string): Lock | null {
  const dir = locksDir()
  mkdirSync(dir, { recursive: true })

  const lockPath = resolve(dir, `${filename}.lock`)

  if (existsSync(lockPath)) {
    return null // already claimed
  }

  try {
    // O_EXCL ensures atomicity — only one process can create this file
    writeFileSync(lockPath, JSON.stringify({ agentId, ts: new Date().toISOString(), file: filename }), { flag: 'wx' })
  } catch {
    return null // race condition: another process won
  }

  return {
    file: filename,
    lockPath,
    agentId,
    release: () => releaseLock(lockPath),
  }
}

export function releaseLock(lockPath: string) {
  try {
    unlinkSync(lockPath)
  } catch {
    // Already released
  }
}

export function isLocked(filename: string): boolean {
  return existsSync(resolve(locksDir(), `${filename}.lock`))
}

export function getLockInfo(filename: string): { agentId: string; ts: string } | null {
  const lockPath = resolve(locksDir(), `${filename}.lock`)
  if (!existsSync(lockPath)) return null
  try {
    return JSON.parse(readFileSync(lockPath, 'utf-8'))
  } catch {
    return null
  }
}
