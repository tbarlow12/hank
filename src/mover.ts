import { renameSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { resolve, basename } from 'path'
import matter from 'gray-matter'
import { getRoot } from './config.js'
import { updateFrontmatter, appendSection } from './frontmatter.js'
import type { Lock } from './claim.js'
import type { PipelineConfig, Directive } from './types.js'
import { getNextStage } from './pipeline.js'
import { logStage, logItem } from './logger.js'

export function moveItem(
  filePath: string,
  lock: Lock,
  pipeline: PipelineConfig,
  currentStage: string,
  directive: Directive,
  reason?: string,
  output?: string,
  splits?: string[],
): string {
  const root = getRoot()
  const filename = basename(filePath)

  // SPLIT: create child work items, move parent to done
  if (directive === 'SPLIT' && splits && splits.length > 0) {
    return handleSplit(filePath, filename, lock, pipeline, currentStage, root, splits)
  }

  // Check attempt count for REJECT
  let targetStage: string
  if (directive === 'REJECT') {
    // Read current attempt from frontmatter
    const raw = readFileSync(filePath, 'utf-8')
    const { data } = matter(raw)
    const attempt = (data.attempt || 1) + 1

    if (attempt > pipeline.max_attempts) {
      targetStage = 'failed'
      logStage(currentStage, `${filename} exceeded max attempts (${pipeline.max_attempts}), moving to failed/`)
    } else {
      targetStage = getNextStage(pipeline, currentStage, directive)
      updateFrontmatter(filePath, { attempt } as any)
    }
  } else {
    targetStage = getNextStage(pipeline, currentStage, directive)
  }

  // Update frontmatter
  const now = new Date().toISOString()
  updateFrontmatter(filePath, {
    stage: targetStage,
    status: targetStage === 'done' || targetStage === 'failed' ? targetStage as any : 'pending',
    assignee: '',
    history: `${currentStage}→${targetStage}:${now}`,
  } as any)

  // Append feedback to relevant section if REJECT
  if (directive === 'REJECT' && reason) {
    const sectionMap: Record<string, string> = {
      review: 'Review Notes',
      test: 'Test Results',
      'code-review': 'Code Review',
    }
    const section = sectionMap[currentStage] || 'Review Notes'
    appendSection(filePath, section, `**Rejected** (${now}): ${reason}`)
  }

  // Append output to relevant section
  if (output && directive === 'PASS') {
    const sectionMap: Record<string, string> = {
      drafts: 'Plan',
      plans: 'Plan',
      review: 'Review Notes',
      build: 'Build Log',
      test: 'Test Results',
      'code-review': 'Code Review',
    }
    const section = sectionMap[currentStage]
    if (section) {
      appendSection(filePath, section, output)
    }
  }

  // Move file
  const targetDir = resolve(root, 'pipeline', targetStage)
  const targetPath = resolve(targetDir, filename)
  renameSync(filePath, targetPath)

  // Release lock
  lock.release()

  logItem(filename.replace('.md', ''), currentStage, lock.agentId, `${directive} → ${targetStage}`)
  return targetPath
}

function handleSplit(
  filePath: string,
  filename: string,
  lock: Lock,
  pipeline: PipelineConfig,
  currentStage: string,
  root: string,
  splits: string[],
): string {
  const now = new Date().toISOString()
  const parentId = filename.replace('.md', '')
  const targetStage = getNextStage(pipeline, currentStage, 'PASS') // splits advance like PASS

  const targetDir = resolve(root, 'pipeline', targetStage)
  mkdirSync(targetDir, { recursive: true })

  // Create each child work item
  for (let i = 0; i < splits.length; i++) {
    const splitContent = splits[i]

    // Try to extract a title from the first heading or first line
    const titleMatch = splitContent.match(/^#\s+(.+)/m) || splitContent.match(/^title:\s*(.+)/mi)
    const title = titleMatch ? titleMatch[1].trim() : `${parentId}-part-${i + 1}`
    const childId = `${parentId}-${i + 1}`

    const childFrontmatter = {
      id: childId,
      title,
      source: 'split',
      created: now,
      branch: '',
      status: 'pending' as const,
      stage: targetStage,
      attempt: 1,
      history: `${currentStage}:split:${now}`,
      assignee: '',
      parent: parentId,
    }

    const childFile = matter.stringify('\n' + splitContent + '\n', childFrontmatter)
    const childPath = resolve(targetDir, `${childId}.md`)
    writeFileSync(childPath, childFile, 'utf-8')

    logItem(childId, currentStage, lock.agentId, `Split child ${i + 1}/${splits.length} → ${targetStage}`)
  }

  // Move parent to done
  const doneDir = resolve(root, 'pipeline/done')
  mkdirSync(doneDir, { recursive: true })
  updateFrontmatter(filePath, {
    status: 'done' as any,
    stage: 'done',
    assignee: '',
    history: `${currentStage}→split(${splits.length}):${now}`,
  } as any)
  appendSection(filePath, 'Plan', `**Split into ${splits.length} work items** (${now}):\n${splits.map((_, i) => `- ${parentId}-${i + 1}`).join('\n')}`)

  const donePath = resolve(doneDir, filename)
  renameSync(filePath, donePath)
  lock.release()

  logStage(currentStage, `${filename} SPLIT into ${splits.length} items → ${targetStage}`)
  return donePath
}
