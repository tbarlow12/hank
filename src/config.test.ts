import { describe, it, expect } from 'vitest'
import { getPlanner, getExecutors, stageDir, PIPELINE_DIR } from './config.js'
import { resolve } from 'path'
import type { Agent } from './types.js'

const agents: Agent[] = [
  { id: 'agent-0', dir: '/dev/0/land-catalyst', role: 'planner' },
  { id: 'agent-1', dir: '/dev/1/land-catalyst', role: 'executor' },
  { id: 'agent-2', dir: '/dev/2/land-catalyst', role: 'executor' },
]

describe('getPlanner', () => {
  it('returns the planner agent', () => {
    expect(getPlanner(agents)).toEqual(agents[0])
  })

  it('returns undefined if no planner', () => {
    expect(getPlanner(agents.filter(a => a.role === 'executor'))).toBeUndefined()
  })
})

describe('getExecutors', () => {
  it('returns only executor agents', () => {
    const execs = getExecutors(agents)
    expect(execs).toHaveLength(2)
    expect(execs.every(a => a.role === 'executor')).toBe(true)
  })

  it('returns empty array if no executors', () => {
    expect(getExecutors([agents[0]])).toEqual([])
  })
})

describe('stageDir', () => {
  it('returns PIPELINE_DIR/<stage>', () => {
    expect(stageDir('1-Ideas')).toBe(resolve(PIPELINE_DIR, '1-Ideas'))
    expect(stageDir('5-Done')).toBe(resolve(PIPELINE_DIR, '5-Done'))
  })
})
