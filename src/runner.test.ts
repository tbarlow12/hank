import { describe, it, expect } from 'vitest'
import { parseDirective, parseSplits } from './runner.js'

describe('parseDirective', () => {
  it('parses PASS', () => {
    const r = parseDirective('some output\nDIRECTIVE: PASS')
    expect(r).toEqual({ directive: 'PASS', reason: undefined, pr_url: undefined })
  })

  it('parses FAIL with reason', () => {
    const r = parseDirective('output\nDIRECTIVE: FAIL reason="something broke"')
    expect(r).toEqual({ directive: 'FAIL', reason: 'something broke', pr_url: undefined })
  })

  it('parses REJECT with reason', () => {
    const r = parseDirective('output\nDIRECTIVE: REJECT reason="needs work"')
    expect(r).toEqual({ directive: 'REJECT', reason: 'needs work', pr_url: undefined })
  })

  it('parses SPLIT', () => {
    const r = parseDirective('part1\n<!-- SPLIT -->\npart2\nDIRECTIVE: SPLIT')
    expect(r?.directive).toBe('SPLIT')
    expect(r?.splits).toBeDefined()
    expect(r!.splits!.length).toBe(2)
  })

  it('is case-insensitive', () => {
    const r = parseDirective('directive: pass')
    expect(r?.directive).toBe('PASS')
  })

  it('scans bottom-up (last directive wins)', () => {
    const r = parseDirective('DIRECTIVE: FAIL reason="old"\nstuff\nDIRECTIVE: PASS')
    expect(r?.directive).toBe('PASS')
  })

  it('captures pr_url', () => {
    const r = parseDirective('output\nDIRECTIVE: PASS\npr_url: https://github.com/org/repo/pull/42')
    expect(r?.pr_url).toBe('https://github.com/org/repo/pull/42')
  })

  it('returns null when no directive found', () => {
    expect(parseDirective('just some text')).toBeNull()
    expect(parseDirective('')).toBeNull()
  })
})

describe('parseSplits', () => {
  it('splits on <!-- SPLIT -->', () => {
    const r = parseSplits('part1\n<!-- SPLIT -->\npart2\nDIRECTIVE: SPLIT')
    expect(r).toEqual(['part1', 'part2'])
  })

  it('trims parts and filters empties', () => {
    const r = parseSplits('  part1  \n<!-- SPLIT -->\n\n<!-- SPLIT -->\n  part2  \nDIRECTIVE: SPLIT')
    expect(r).toEqual(['part1', 'part2'])
  })

  it('strips trailing DIRECTIVE line from last part', () => {
    const r = parseSplits('part1\n<!-- SPLIT -->\npart2\nDIRECTIVE: SPLIT reason="done"')
    expect(r).toEqual(['part1', 'part2'])
  })

  it('handles varied whitespace in markers', () => {
    const r = parseSplits('part1\n<!--  SPLIT  -->\npart2\nDIRECTIVE: SPLIT')
    expect(r).toEqual(['part1', 'part2'])
  })

  it('returns empty array for no content', () => {
    expect(parseSplits('DIRECTIVE: SPLIT')).toEqual([])
  })
})
