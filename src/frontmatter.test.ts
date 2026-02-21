import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'fs'
import { resolve } from 'path'
import { tmpdir } from 'os'
import matter from 'gray-matter'
import { parseWorkItem, updateFrontmatter, appendSection } from './frontmatter.js'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(resolve(tmpdir(), 'dp-test-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function writeItem(filename: string, fm: Record<string, any>, body: string): string {
  const p = resolve(dir, filename)
  writeFileSync(p, matter.stringify(body, fm), 'utf-8')
  return p
}

describe('parseWorkItem', () => {
  it('reads and parses frontmatter correctly', () => {
    const p = writeItem('test.md', { id: 'test-1', title: 'Test', status: 'pending', stage: '1-Ideas', attempt: 1 }, '\n## Description\n\nDo the thing\n')
    const { data, content } = parseWorkItem(p)
    expect(data.id).toBe('test-1')
    expect(data.title).toBe('Test')
    expect(data.status).toBe('pending')
    expect(content).toContain('Do the thing')
  })
})

describe('updateFrontmatter', () => {
  it('merges updates and preserves content', () => {
    const p = writeItem('test.md', { id: 'x', status: 'pending', attempt: 1 }, '\nbody text\n')
    updateFrontmatter(p, { status: 'in_progress', attempt: 2 } as any)
    const { data, content } = parseWorkItem(p)
    expect(data.status).toBe('in_progress')
    expect(data.attempt).toBe(2)
    expect(data.id).toBe('x')
    expect(content).toContain('body text')
  })
})

describe('appendSection', () => {
  it('adds new section at end when missing', () => {
    const p = writeItem('test.md', { id: 'x' }, '\n## Description\n\nHello\n')
    appendSection(p, 'Plan', 'The plan is...')
    const raw = readFileSync(p, 'utf-8')
    expect(raw).toContain('## Plan')
    expect(raw).toContain('The plan is...')
    expect(raw.indexOf('## Plan')).toBeGreaterThan(raw.indexOf('## Description'))
  })

  it('appends under existing heading', () => {
    const p = writeItem('test.md', { id: 'x' }, '\n## Plan\n\nOld plan\n')
    appendSection(p, 'Plan', 'New plan addition')
    const raw = readFileSync(p, 'utf-8')
    expect(raw).toContain('Old plan')
    expect(raw).toContain('New plan addition')
  })

  it('inserts before next ## heading', () => {
    const p = writeItem('test.md', { id: 'x' }, '\n## Plan\n\nOld plan\n\n## Feedback\n\nStuff\n')
    appendSection(p, 'Plan', 'Inserted content')
    const raw = readFileSync(p, 'utf-8')
    const planIdx = raw.indexOf('## Plan')
    const insertIdx = raw.indexOf('Inserted content')
    const feedbackIdx = raw.indexOf('## Feedback')
    expect(insertIdx).toBeGreaterThan(planIdx)
    expect(insertIdx).toBeLessThan(feedbackIdx)
  })
})
