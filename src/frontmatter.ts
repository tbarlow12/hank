import matter from 'gray-matter'
import { readFileSync, writeFileSync } from 'fs'
import type { WorkItem } from './types.js'

export function parseWorkItem(filePath: string): { data: WorkItem; content: string; raw: string } {
  const raw = readFileSync(filePath, 'utf-8')
  const { data, content } = matter(raw)
  return { data: data as WorkItem, content, raw }
}

export function updateFrontmatter(filePath: string, updates: Partial<WorkItem>): void {
  const { data, content } = parseWorkItem(filePath)
  const merged = { ...data, ...updates }
  const out = matter.stringify(content, merged)
  writeFileSync(filePath, out, 'utf-8')
}

export function appendSection(filePath: string, section: string, text: string): void {
  const raw = readFileSync(filePath, 'utf-8')
  const heading = `## ${section}`
  const idx = raw.indexOf(heading)
  if (idx === -1) {
    // Append new section at end
    writeFileSync(filePath, raw.trimEnd() + `\n\n${heading}\n\n${text}\n`, 'utf-8')
  } else {
    // Find end of section (next ## or EOF)
    const afterHeading = idx + heading.length
    const nextSection = raw.indexOf('\n## ', afterHeading)
    const insertAt = nextSection === -1 ? raw.length : nextSection
    const updated = raw.slice(0, insertAt).trimEnd() + '\n\n' + text + '\n' + raw.slice(insertAt)
    writeFileSync(filePath, updated, 'utf-8')
  }
}

export function createWorkItemContent(item: WorkItem, description: string): string {
  return matter.stringify(
    `\n## Description\n\n${description}\n\n## Plan\n\n\n\n## Review Notes\n\n\n\n## Build Log\n\n\n\n## Test Results\n\n\n\n## Code Review\n\n`,
    item as any
  )
}
