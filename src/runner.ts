import { spawn } from 'child_process'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { ROOT, PLANNER_MODEL, EXECUTOR_MODEL } from './config.js'
import { parseWorkItem } from './frontmatter.js'
import type { Agent, RunResult, Directive } from './types.js'

export async function runAgent(
  workItemPath: string,
  stage: string,
  agent: Agent,
  promptFile: string,
): Promise<RunResult> {
  const workItemContent = readFileSync(workItemPath, 'utf-8')
  const systemPromptFile = resolve(ROOT, promptFile)

  // Check for existing session ID for resume
  const { data } = parseWorkItem(workItemPath)
  const resumeSessionId = data.sessions?.[stage]

  const model = agent.role === 'planner' ? PLANNER_MODEL : EXECUTOR_MODEL

  return invokeClaude(systemPromptFile, workItemContent, model, agent.dir, resumeSessionId)
}

async function invokeClaude(
  systemPromptFile: string,
  userPrompt: string,
  model: string,
  cwd: string,
  resumeSessionId?: string,
): Promise<RunResult> {
  const args = ['--print', '--output-format', 'json']

  args.push('--model', model)
  args.push('--append-system-prompt-file', systemPromptFile)
  args.push('--max-turns', '50')
  args.push('--permission-mode', 'bypassPermissions')

  if (resumeSessionId) {
    args.push('--resume', resumeSessionId)
  }

  args.push('--prompt', userPrompt)

  return new Promise<RunResult>((res, rej) => {
    const proc = spawn('claude', args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    proc.stderr.on('data', (chunk: Buffer) => {
      const line = chunk.toString()
      stderr += line
      process.stderr.write(line) // stream stderr for visibility
    })

    proc.on('close', (code) => {
      let output = stdout.trim()
      let sessionId: string | undefined

      try {
        const json = JSON.parse(output)
        output = json.result || output
        sessionId = json.session_id
      } catch { /* not JSON, use raw */ }

      const parsed = parseDirective(output)
      if (parsed) {
        res({ ...parsed, output, session_id: sessionId })
      } else if (code !== 0) {
        res({ directive: 'FAIL', reason: `claude exited ${code}: ${stderr.slice(0, 500)}`, output, session_id: sessionId })
      } else {
        res({ directive: 'FAIL', reason: 'No DIRECTIVE found in output', output, session_id: sessionId })
      }
    })

    proc.on('error', (err) => {
      rej(new Error(`Failed to spawn claude: ${err.message}`))
    })
  })
}

function parseDirective(output: string): { directive: Directive; reason?: string; pr_url?: string; splits?: string[] } | null {
  const lines = output.split('\n').reverse()
  let prUrl: string | undefined

  for (const line of lines) {
    const prMatch = line.match(/^pr_url:\s*(.+)/i)
    if (prMatch) prUrl = prMatch[1].trim()

    const match = line.match(/^DIRECTIVE:\s*(PASS|REJECT|FAIL|SPLIT)(?:\s+reason="([^"]*)")?/i)
    if (match) {
      const directive = match[1].toUpperCase() as Directive
      const reason = match[2] || undefined

      if (directive === 'SPLIT') {
        return { directive, reason, splits: parseSplits(output) }
      }

      return { directive, reason, pr_url: prUrl }
    }
  }

  return null
}

function parseSplits(output: string): string[] {
  return output.split(/<!--\s*SPLIT\s*-->/)
    .map(p => p.trim())
    .filter(p => p.length > 0 && !p.match(/^DIRECTIVE:\s*SPLIT/im))
    .map(p => p.replace(/\nDIRECTIVE:\s*SPLIT.*$/im, '').trim())
    .filter(p => p.length > 0)
}
