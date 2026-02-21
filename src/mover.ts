import { renameSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { resolve, basename } from 'path'
import matter from 'gray-matter'
import { PIPELINE_DIR, MAX_ATTEMPTS } from './config.js'
import { updateFrontmatter, appendSection } from './frontmatter.js'
import type { Lock } from './claim.js'
import type { Directive } from './types.js'
import { logStage, logItem } from './logger.js'

// Fixed transitions for 3-stage pipeline
export const TRANSITIONS: Record<string, Record<string, string>> = {
  '1-Ideas': { PASS: '2-Plans', SPLIT: '2-Plans', FAIL: '4-Failures', REJECT: '4-Failures' },
  '2-Plans': { PASS: '3-Work', FAIL: '4-Failures', REJECT: '1-Ideas' },
  '3-Work':  { PASS: '5-Done', FAIL: '4-Failures', REJECT: '2-Plans' },
}

export function moveItem(
  filePath: string,
  lock: Lock,
  currentStage: string,
  directive: Directive,
  reason?: string,
  output?: string,
  splits?: string[],
): string {
  const filename = basename(filePath)

  // SPLIT: create children, move parent to done
  if (directive === 'SPLIT' && splits && splits.length > 0) {
    return handleSplit(filePath, filename, lock, currentStage, splits)
  }

  let targetStage: string
  if (directive === 'REJECT') {
    const raw = readFileSync(filePath, 'utf-8')
    const { data } = matter(raw)
    const attempt = (data.attempt || 1) + 1
    if (attempt > MAX_ATTEMPTS) {
      targetStage = '4-Failures'
      logStage(currentStage, `${filename} exceeded max attempts (${MAX_ATTEMPTS}), moving to 4-Failures/`)
    } else {
      targetStage = TRANSITIONS[currentStage]?.REJECT || '4-Failures'
      updateFrontmatter(filePath, { attempt } as any)
    }
  } else {
    targetStage = TRANSITIONS[currentStage]?.[directive]
    if (!targetStage) targetStage = '4-Failures'
  }

  // Update frontmatter
  const now = new Date().toISOString()
  const status = targetStage === '5-Done' ? 'done' as const
    : targetStage === '4-Failures' ? 'failed' as const
    : 'pending' as const

  updateFrontmatter(filePath, {
    stage: targetStage,
    status,
    assignee: '',
    history: `${currentStage}→${targetStage}:${now}`,
  } as any)

  // Append output to relevant section
  if (output && directive === 'PASS') {
    const sectionMap: Record<string, string> = {
      '1-Ideas': 'Plan',
      '2-Plans': 'Execution Log',
      '3-Work': 'Completion',
    }
    const section = sectionMap[currentStage]
    if (section) appendSection(filePath, section, output)
  }

  if (directive === 'REJECT' && reason) {
    appendSection(filePath, 'Feedback', `**Rejected** (${new Date().toISOString()}): ${reason}`)
  }

  // Move file
  const targetDir = resolve(PIPELINE_DIR, targetStage)
  mkdirSync(targetDir, { recursive: true })
  const targetPath = resolve(targetDir, filename)
  renameSync(filePath, targetPath)

  lock.release()
  logItem(filename.replace('.md', ''), currentStage, lock.agentId, `${directive} → ${targetStage}`)
  return targetPath
}

function handleSplit(
  filePath: string,
  filename: string,
  lock: Lock,
  currentStage: string,
  splits: string[],
): string {
  const now = new Date().toISOString()
  const parentId = filename.replace('.md', '')
  const targetStage = '2-Plans'

  const targetDir = resolve(PIPELINE_DIR, targetStage)
  mkdirSync(targetDir, { recursive: true })

  for (let i = 0; i < splits.length; i++) {
    const splitContent = splits[i]
    const titleMatch = splitContent.match(/^#\s+(.+)/m) || splitContent.match(/^title:\s*(.+)/mi)
    const title = titleMatch ? titleMatch[1].trim() : `${parentId}-part-${i + 1}`
    const childId = `${parentId}-${i + 1}`

    const childFrontmatter = {
      id: childId,
      title,
      status: 'pending' as const,
      stage: targetStage,
      attempt: 1,
      created: now,
      history: `${currentStage}:split:${now}`,
      assignee: '',
      parent: parentId,
    }

    writeFileSync(resolve(targetDir, `${childId}.md`), matter.stringify('\n' + splitContent + '\n', childFrontmatter), 'utf-8')
    logItem(childId, currentStage, lock.agentId, `Split child ${i + 1}/${splits.length} → ${targetStage}`)
  }

  // Move parent to done
  const doneDir = resolve(PIPELINE_DIR, '5-Done')
  mkdirSync(doneDir, { recursive: true })
  updateFrontmatter(filePath, { status: 'done' as any, stage: '5-Done', assignee: '' } as any)
  appendSection(filePath, 'Plan', `**Split into ${splits.length} work items** (${now}):\n${splits.map((_, i) => `- ${parentId}-${i + 1}`).join('\n')}`)

  const donePath = resolve(doneDir, filename)
  renameSync(filePath, donePath)
  lock.release()

  logStage(currentStage, `${filename} SPLIT into ${splits.length} items → ${targetStage}`)
  return donePath
}
