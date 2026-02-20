import { spawn } from 'child_process'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { createInterface } from 'readline/promises'
import chalk from 'chalk'
import { loadConfig, getRoot } from './config.js'

interface ParsedBlock {
  filename: string
  content: string
}

export async function editConfig(description: string, autoApply: boolean) {
  const root = getRoot()
  const config = loadConfig()

  // Read current configs
  const hankPath = resolve(root, 'hank.yml')
  const pipelinePath = resolve(root, 'pipeline.yml')
  const hankYml = readFileSync(hankPath, 'utf-8')
  const pipelineYml = readFileSync(pipelinePath, 'utf-8')

  // Build prompt
  const prompt = [
    'Here are the current Hank configuration files.',
    '',
    '## hank.yml',
    '```yaml',
    hankYml.trimEnd(),
    '```',
    '',
    '## pipeline.yml',
    '```yaml',
    pipelineYml.trimEnd(),
    '```',
    '',
    '## Requested Change',
    description,
  ].join('\n')

  // Resolve CLI + model
  const cliName = config.defaults.cli
  const cliConfig = config.cli[cliName]
  if (!cliConfig) throw new Error(`Unknown CLI: ${cliName}`)

  const modelIntent = 'powerful'
  const model = cliConfig.models?.[modelIntent] || modelIntent

  const args = [...(cliConfig.args || [])]
  args.push('--append-system-prompt-file', resolve(root, 'agents/config-editor.md'))
  args.push('--model', model)
  args.push('--max-turns', '1')
  args.push('--output-format', 'json')
  args.push('--no-session-persistence')
  args.push('--prompt', prompt)

  console.log(chalk.dim(`Asking ${cliName} to edit config...`))

  // Spawn CLI
  const output = await new Promise<string>((res, rej) => {
    const proc = spawn(cliConfig.command, args, {
      cwd: root,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    })

    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (c: Buffer) => { stdout += c.toString() })
    proc.stderr.on('data', (c: Buffer) => { stderr += c.toString() })

    proc.on('close', (code) => {
      let text = stdout.trim()
      try {
        const json = JSON.parse(text)
        text = json.result || text
      } catch { /* raw output */ }

      if (code !== 0 && !text) {
        rej(new Error(`CLI exited with code ${code}: ${stderr.slice(0, 500)}`))
      } else {
        res(text)
      }
    })

    proc.on('error', (err) => {
      rej(new Error(`Failed to spawn ${cliConfig.command}: ${err.message}`))
    })
  })

  // Parse fenced YAML blocks
  const blocks = parseFencedBlocks(output)
  if (blocks.length === 0) {
    console.log(chalk.yellow('No config changes detected in LLM output.'))
    return
  }

  // Map filenames to paths + current content
  const fileMap: Record<string, { path: string; current: string }> = {
    'hank.yml': { path: hankPath, current: hankYml },
    'pipeline.yml': { path: pipelinePath, current: pipelineYml },
  }

  // Show diffs and collect changes
  const changes: { path: string; content: string }[] = []

  for (const block of blocks) {
    const entry = fileMap[block.filename]
    if (!entry) {
      console.log(chalk.yellow(`Unknown file: ${block.filename} — skipping`))
      continue
    }

    if (block.content.trimEnd() === entry.current.trimEnd()) {
      console.log(chalk.dim(`${block.filename}: no changes`))
      continue
    }

    console.log(chalk.bold(`\n--- ${block.filename} ---\n`))
    showDiff(entry.current, block.content)
    changes.push({ path: entry.path, content: block.content })
  }

  if (changes.length === 0) {
    console.log(chalk.dim('No effective changes.'))
    return
  }

  // Confirm
  if (!autoApply) {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const answer = await rl.question('\nApply these changes? (y/n): ')
    rl.close()
    if (!answer.trim().toLowerCase().startsWith('y')) {
      console.log(chalk.dim('Aborted.'))
      return
    }
  }

  // Write
  for (const { path, content } of changes) {
    writeFileSync(path, content.endsWith('\n') ? content : content + '\n', 'utf-8')
  }
  console.log(chalk.green(`\nUpdated ${changes.length} file${changes.length > 1 ? 's' : ''}.`))
}

function parseFencedBlocks(text: string): ParsedBlock[] {
  const blocks: ParsedBlock[] = []
  const regex = /```ya?ml:(\S+)\n([\s\S]*?)```/g
  let match
  while ((match = regex.exec(text)) !== null) {
    blocks.push({ filename: match[1], content: match[2] })
  }
  return blocks
}

function showDiff(before: string, after: string) {
  const oldLines = before.split('\n')
  const newLines = after.split('\n')
  const maxLen = Math.max(oldLines.length, newLines.length)

  for (let i = 0; i < maxLen; i++) {
    const old = oldLines[i]
    const cur = newLines[i]

    if (old === undefined) {
      console.log(chalk.green(`+ ${cur}`))
    } else if (cur === undefined) {
      console.log(chalk.red(`- ${old}`))
    } else if (old !== cur) {
      console.log(chalk.red(`- ${old}`))
      console.log(chalk.green(`+ ${cur}`))
    }
  }
}
