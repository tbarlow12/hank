import { spawn } from 'child_process'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { getRoot } from './config.js'
import { logItem } from './logger.js'
import type { AgentConfig, HenryConfig, StageConfig, RunResult, Directive } from './types.js'

export async function runAgent(
  workItemPath: string,
  stageName: string,
  stageConfig: StageConfig,
  agent: AgentConfig,
  config: HenryConfig,
): Promise<RunResult> {
  const root = getRoot()
  const workItemContent = readFileSync(workItemPath, 'utf-8')

  // Load prompt template
  const promptPath = resolve(root, stageConfig.prompt)
  const promptTemplate = readFileSync(promptPath, 'utf-8')

  // Build the full prompt
  const fullPrompt = `${promptTemplate}\n\n---\n\n# Work Item\n\n${workItemContent}`

  // Run the agent
  let result = await invokeClI(fullPrompt, stageConfig, agent, config)

  // Inner loop: if configured, run test after build and loop on REJECT
  if (stageConfig.inner_loop && result.directive === 'PASS') {
    const { inner_loop } = stageConfig
    const testPromptPath = resolve(root, inner_loop.test_prompt)
    const testPrompt = readFileSync(testPromptPath, 'utf-8')

    for (let i = 0; i < inner_loop.max_iterations; i++) {
      logItem(stageName, stageName, agent.id, `Inner loop iteration ${i + 1}/${inner_loop.max_iterations}`)

      // Run tester
      const testResult = await invokeClI(
        `${testPrompt}\n\n---\n\n# Work Item\n\n${workItemContent}\n\n## Previous Build Output\n\n${result.output}`,
        stageConfig,
        agent,
        config,
      )

      if (testResult.directive === 'PASS') {
        return { ...testResult, iterations: i + 1 }
      }

      if (testResult.directive === 'FAIL') {
        return testResult
      }

      // REJECT: re-invoke builder with feedback
      const retryPrompt = `${promptTemplate}\n\n---\n\n# Work Item\n\n${workItemContent}\n\n## Test Failure Feedback (iteration ${i + 1})\n\n${testResult.reason || testResult.output}\n\nFix the issues above and try again.`

      result = await invokeClI(retryPrompt, stageConfig, agent, config)

      if (result.directive === 'FAIL') {
        return result
      }
    }

    // Exhausted iterations — fall through as REJECT
    return { directive: 'REJECT', reason: `Inner loop exhausted after ${inner_loop.max_iterations} iterations`, output: result.output }
  }

  return result
}

async function invokeClI(
  prompt: string,
  stageConfig: StageConfig,
  agent: AgentConfig,
  config: HenryConfig,
): Promise<RunResult> {
  const cliName = config.defaults.cli
  const cliConfig = config.cli[cliName]
  if (!cliConfig) throw new Error(`Unknown CLI: ${cliName}`)

  const args = [...(cliConfig.args || [])]

  // Add model flag
  const model = stageConfig.model || config.defaults.model
  if (model) args.push('--model', model)

  // Add max turns
  const maxTurns = stageConfig.max_turns || config.defaults.max_turns
  if (maxTurns) args.push('--max-turns', String(maxTurns))

  // Add prompt via stdin using --prompt flag
  args.push('--prompt', prompt)

  return new Promise<RunResult>((resolve, reject) => {
    const proc = spawn(cliConfig.command, args, {
      cwd: agent.path,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })

    proc.on('close', (code) => {
      const output = stdout.trim()
      const result = parseDirective(output)

      if (result) {
        resolve({ ...result, output })
      } else if (code !== 0) {
        resolve({ directive: 'FAIL', reason: `CLI exited with code ${code}: ${stderr.slice(0, 500)}`, output })
      } else {
        // No directive found — treat as FAIL
        resolve({ directive: 'FAIL', reason: 'No DIRECTIVE line found in output', output })
      }
    })

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn ${cliConfig.command}: ${err.message}`))
    })
  })
}

function parseDirective(output: string): { directive: Directive; reason?: string; pr_url?: string; splits?: string[] } | null {
  // Search from end of output for DIRECTIVE line
  const lines = output.split('\n').reverse()

  for (const line of lines) {
    const match = line.match(/^DIRECTIVE:\s*(PASS|REJECT|FAIL|SPLIT)(?:\s+reason="([^"]*)")?/i)
    if (match) {
      const directive = match[1].toUpperCase() as Directive
      const reason = match[2] || undefined

      // For SPLIT, parse out the individual work items delimited by <!-- SPLIT -->
      if (directive === 'SPLIT') {
        const splits = parseSplits(output)
        return { directive, reason, splits }
      }

      return { directive, reason }
    }

    // Also check for pr_url
    const prMatch = line.match(/^pr_url:\s*(.+)/i)
    if (prMatch) {
      // Keep scanning for directive
    }
  }

  return null
}

function parseSplits(output: string): string[] {
  // Split on <!-- SPLIT --> markers
  const parts = output.split(/<!--\s*SPLIT\s*-->/)
  // Filter out empty parts and the directive line itself
  return parts
    .map(p => p.trim())
    .filter(p => p.length > 0 && !p.match(/^DIRECTIVE:\s*SPLIT/im))
    .map(p => p.replace(/\nDIRECTIVE:\s*SPLIT.*$/im, '').trim())
    .filter(p => p.length > 0)
}
