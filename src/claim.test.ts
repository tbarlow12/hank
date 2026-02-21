import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { tmpdir } from 'os'

// Mock LOCKS_DIR before importing claim module
let mockLocksDir: string

vi.mock('./config.js', () => ({
  get LOCKS_DIR() { return mockLocksDir },
}))

// Import after mock
const { tryClaimFile, isLocked, getLockInfo, clearStaleLocks } = await import('./claim.js')

let dir: string

beforeEach(() => {
  dir = mkdtempSync(resolve(tmpdir(), 'dp-lock-test-'))
  mockLocksDir = dir
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('tryClaimFile', () => {
  it('creates lock and returns Lock object', () => {
    const lock = tryClaimFile('test.md', 'agent-1')
    expect(lock).not.toBeNull()
    expect(lock!.file).toBe('test.md')
    expect(lock!.agentId).toBe('agent-1')
    expect(existsSync(lock!.lockPath)).toBe(true)
  })

  it('returns null if already locked', () => {
    tryClaimFile('test.md', 'agent-1')
    const second = tryClaimFile('test.md', 'agent-2')
    expect(second).toBeNull()
  })

  it('reclaims stale lock (>60min)', () => {
    const lockPath = resolve(dir, 'test.md.lock')
    const staleTs = new Date(Date.now() - 61 * 60 * 1000).toISOString()
    writeFileSync(lockPath, JSON.stringify({ agentId: 'agent-old', ts: staleTs, file: 'test.md' }))

    const lock = tryClaimFile('test.md', 'agent-new')
    expect(lock).not.toBeNull()
    expect(lock!.agentId).toBe('agent-new')
  })
})

describe('release', () => {
  it('removes lock file', () => {
    const lock = tryClaimFile('test.md', 'agent-1')!
    expect(existsSync(lock.lockPath)).toBe(true)
    lock.release()
    expect(existsSync(lock.lockPath)).toBe(false)
  })
})

describe('isLocked', () => {
  it('returns true when locked', () => {
    tryClaimFile('test.md', 'agent-1')
    expect(isLocked('test.md')).toBe(true)
  })

  it('returns false when not locked', () => {
    expect(isLocked('nope.md')).toBe(false)
  })
})

describe('getLockInfo', () => {
  it('returns lock info when locked', () => {
    tryClaimFile('test.md', 'agent-1')
    const info = getLockInfo('test.md')
    expect(info).not.toBeNull()
    expect(info!.agentId).toBe('agent-1')
    expect(info!.ts).toBeDefined()
  })

  it('returns null when not locked', () => {
    expect(getLockInfo('nope.md')).toBeNull()
  })
})

describe('clearStaleLocks', () => {
  it('removes old locks and keeps fresh ones', () => {
    // Stale lock
    const stalePath = resolve(dir, 'stale.md.lock')
    const staleTs = new Date(Date.now() - 120 * 60 * 1000).toISOString()
    writeFileSync(stalePath, JSON.stringify({ agentId: 'agent-old', ts: staleTs }))

    // Fresh lock
    tryClaimFile('fresh.md', 'agent-1')

    clearStaleLocks()

    expect(existsSync(stalePath)).toBe(false)
    expect(existsSync(resolve(dir, 'fresh.md.lock'))).toBe(true)
  })
})
