import { spawn } from 'child_process'
import { readFileSync, unlinkSync } from 'fs'
import { resolve } from 'path'
import { getRoot, getAgentProjectPath, getDefaultProject } from './config.js'
import { buildSystemPrompt, getRoleToolOverrides } from './project-config.js'
import { logItem } from './logger.js'
import type { AgentConfig, HankConfig, StageConfig, RunResult, Directive, CliToolConfig } from './types.js'

export async function runAgent(
  workItemPath: string,
  stageName: string,
  stageConfig: StageConfig,
  agent: AgentConfig,
  config: HankConfig,
  projectName?: string,
): Promise<RunResult> {
  const root = getRoot()
  const workItemContent = readFileSync(workItemPath, 'utf-8')
  const basePromptFile = resolve(root, stageConfig.prompt)

  // Resolve which project directory the agent should work in
  const project = projectName || getDefaultProject(config)
  const cwd = getAgentProjectPath(agent, project)

  // Build combined system prompt: agent role + global config + project config + skills
  const systemPromptFile = buildSystemPrompt(basePromptFile, stageName, cwd)

  // Run the agent
  let result: RunResult
  try {
    result = await invokeCLI(systemPromptFile, workItemContent, stageConfig, agent, config, cwd, stageName)
  } finally {
    // Clean up temp prompt file after first invocation reference is done
    // (inner loop will rebuild its own)
  }

  // Inner loop: if configured, run test after build and loop on REJECT
  if (stageConfig.inner_loop && result.directive === 'PASS') {
    const { inner_loop } = stageConfig
    const testBasePrompt = resolve(root, inner_loop.test_prompt)

    for (let i = 0; i < inner_loop.max_iterations; i++) {
      logItem(stageName, stageName, agent.id, `Inner loop iteration ${i + 1}/${inner_loop.max_iterations}`)

      // Build test system prompt (tester role + project config)
      const testSystemPrompt = buildSystemPrompt(testBasePrompt, 'test', cwd)
      const testPrompt = `${workItemContent}\n\n## Previous Build Output\n\n${result.output}`
      const testResult = await invokeCLI(testSystemPrompt, testPrompt, stageConfig, agent, config, cwd, 'test')
      safeUnlink(testSystemPrompt)

      if (testResult.directive === 'PASS') {
        safeUnlink(systemPromptFile)
        return { ...testResult, iterations: i + 1 }
      }

      if (testResult.directive === 'FAIL') {
        safeUnlink(systemPromptFile)
        return testResult
      }

      // REJECT: re-invoke builder with feedback
      const retrySystemPrompt = buildSystemPrompt(basePromptFile, stageName, cwd)
      const retryPrompt = `${workItemContent}\n\n## Test Failure Feedback (iteration ${i + 1})\n\n${testResult.reason || testResult.output}\n\nFix the issues above and try again.`
      result = await invokeCLI(retrySystemPrompt, retryPrompt, stageConfig, agent, config, cwd, stageName)
      safeUnlink(retrySystemPrompt)

      if (result.directive === 'FAIL') {
        return result
      }
    }

    // Exhausted iterations — fall through as REJECT
    safeUnlink(systemPromptFile)
    return { directive: 'REJECT', reason: `Inner loop exhausted after ${inner_loop.max_iterations} iterations`, output: result.output }
  }

  safeUnlink(systemPromptFile)
  return result
}

function safeUnlink(path: string) {
  try { unlinkSync(path) } catch { /* already cleaned */ }
}

async function invokeCLI(
  systemPromptFile: string,
  userPrompt: string,
  stageConfig: StageConfig,
  agent: AgentConfig,
  config: HankConfig,
  cwd: string,
  stageName?: string,
): Promise<RunResult> {
  const cliName = stageConfig.cli || config.defaults.cli
  const cliConfig = config.cli[cliName]
  if (!cliConfig) throw new Error(`Unknown CLI: ${cliName}`)

  const args = [...(cliConfig.args || [])]

  // Agent role as system prompt (repo's CLAUDE.md still auto-loads from cwd)
  args.push('--append-system-prompt-file', systemPromptFile)

  // Model: resolve intent (fast/balanced/powerful) to CLI-specific model name
  const modelIntent = stageConfig.model || config.defaults.model
  const model = resolveModel(modelIntent, cliConfig)
  if (model) args.push('--model', model)

  // Max turns
  const maxTurns = stageConfig.max_turns || config.defaults.max_turns
  if (maxTurns) args.push('--max-turns', String(maxTurns))

  // Max budget
  const maxBudget = stageConfig.max_budget_usd || config.defaults.max_budget_usd
  if (maxBudget) args.push('--max-budget-usd', String(maxBudget))

  // Tool restrictions: merge defaults + stage + global/project role configs
  const roleOverrides = stageName ? getRoleToolOverrides(stageName, cwd) : { allowed: undefined, disallowed: undefined }
  const allowed = dedupe(config.defaults.allowed_tools, stageConfig.allowed_tools, roleOverrides.allowed)
  for (const tool of allowed) args.push('--allowedTools', tool)

  const disallowed = dedupe(config.defaults.disallowed_tools, stageConfig.disallowed_tools, roleOverrides.disallowed)
  for (const tool of disallowed) args.push('--disallowedTools', tool)

  // Permission mode: stage overrides default
  const permMode = stageConfig.permission_mode || config.defaults.permission_mode
  if (permMode) args.push('--permission-mode', permMode)

  // Don't persist sessions — these are ephemeral pipeline runs
  args.push('--no-session-persistence')

  // Structured output for reliable parsing
  args.push('--output-format', 'json')

  // User prompt = the work item content
  args.push('--prompt', userPrompt)

  return new Promise<RunResult>((resolve, reject) => {
    const proc = spawn(cliConfig.command, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })

    proc.on('close', (code) => {
      // Parse JSON output from claude --output-format json
      let output = stdout.trim()
      try {
        const json = JSON.parse(output)
        // claude JSON output has a `result` field with the text content
        output = json.result || output
      } catch {
        // Not JSON — use raw stdout (fallback for non-claude CLIs)
      }

      const result = parseDirective(output)

      if (result) {
        resolve({ ...result, output })
      } else if (code !== 0) {
        resolve({ directive: 'FAIL', reason: `CLI exited with code ${code}: ${stderr.slice(0, 500)}`, output })
      } else {
        resolve({ directive: 'FAIL', reason: 'No DIRECTIVE line found in output', output })
      }
    })

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn ${cliConfig.command}: ${err.message}`))
    })
  })
}

function parseDirective(output: string): { directive: Directive; reason?: string; pr_url?: string; splits?: string[] } | null {
  const lines = output.split('\n').reverse()

  for (const line of lines) {
    const match = line.match(/^DIRECTIVE:\s*(PASS|REJECT|FAIL|SPLIT)(?:\s+reason="([^"]*)")?/i)
    if (match) {
      const directive = match[1].toUpperCase() as Directive
      const reason = match[2] || undefined

      if (directive === 'SPLIT') {
        const splits = parseSplits(output)
        return { directive, reason, splits }
      }

      return { directive, reason }
    }

    const prMatch = line.match(/^pr_url:\s*(.+)/i)
    if (prMatch) {
      // Keep scanning for directive — pr_url is metadata, not the directive
    }
  }

  return null
}

/** Merge multiple tool lists, deduped. */
function dedupe(...lists: (string[] | undefined)[]): string[] {
  const set = new Set<string>()
  for (const list of lists) {
    if (list) for (const item of list) set.add(item)
  }
  return [...set]
}

/** Resolve model intent (fast/balanced/powerful) to CLI-specific model name. */
function resolveModel(intent: string, cliConfig: CliToolConfig): string | undefined {
  if (!intent) return undefined
  // If the CLI has a models map, look up the intent
  if (cliConfig.models && cliConfig.models[intent]) {
    return cliConfig.models[intent]
  }
  // No mapping — pass raw value through (could be a direct model name like "claude-sonnet-4-6")
  return intent
}

function parseSplits(output: string): string[] {
  const parts = output.split(/<!--\s*SPLIT\s*-->/)
  return parts
    .map(p => p.trim())
    .filter(p => p.length > 0 && !p.match(/^DIRECTIVE:\s*SPLIT/im))
    .map(p => p.replace(/\nDIRECTIVE:\s*SPLIT.*$/im, '').trim())
    .filter(p => p.length > 0)
}
