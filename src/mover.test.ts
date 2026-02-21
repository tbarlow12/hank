import { describe, it, expect } from 'vitest'
import { TRANSITIONS } from './mover.js'

describe('TRANSITIONS', () => {
  it('1-Ideas PASS → 2-Plans', () => {
    expect(TRANSITIONS['1-Ideas']['PASS']).toBe('2-Plans')
  })

  it('1-Ideas SPLIT → 2-Plans', () => {
    expect(TRANSITIONS['1-Ideas']['SPLIT']).toBe('2-Plans')
  })

  it('1-Ideas FAIL → 4-Failures', () => {
    expect(TRANSITIONS['1-Ideas']['FAIL']).toBe('4-Failures')
  })

  it('2-Plans PASS → 3-Work', () => {
    expect(TRANSITIONS['2-Plans']['PASS']).toBe('3-Work')
  })

  it('2-Plans REJECT → 1-Ideas', () => {
    expect(TRANSITIONS['2-Plans']['REJECT']).toBe('1-Ideas')
  })

  it('2-Plans FAIL → 4-Failures', () => {
    expect(TRANSITIONS['2-Plans']['FAIL']).toBe('4-Failures')
  })

  it('3-Work PASS → 5-Done', () => {
    expect(TRANSITIONS['3-Work']['PASS']).toBe('5-Done')
  })

  it('3-Work REJECT → 2-Plans', () => {
    expect(TRANSITIONS['3-Work']['REJECT']).toBe('2-Plans')
  })

  it('3-Work FAIL → 4-Failures', () => {
    expect(TRANSITIONS['3-Work']['FAIL']).toBe('4-Failures')
  })

  it('unknown stage returns undefined', () => {
    expect(TRANSITIONS['99-Nope']).toBeUndefined()
  })
})
