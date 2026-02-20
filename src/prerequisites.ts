import { execSync } from 'child_process'
import chalk from 'chalk'
import type { PrereqResult } from './types.js'

function check(cmd: string): string | null {
  try {
    return execSync(cmd, { stdio: 'pipe', encoding: 'utf-8', timeout: 10_000 }).trim()
  } catch {
    return null
  }
}

export function checkPrerequisites(): PrereqResult[] {
  const results: PrereqResult[] = []

  // git
  const gitVersion = check('git --version')
  results.push({
    name: 'git',
    found: !!gitVersion,
    version: gitVersion?.replace('git version ', ''),
    message: gitVersion ? undefined : 'Install git: https://git-scm.com',
  })

  // node
  const nodeVersion = check('node --version')
  results.push({
    name: 'node',
    found: !!nodeVersion,
    version: nodeVersion?.replace('v', ''),
    message: nodeVersion ? undefined : 'Install Node.js >= 18: https://nodejs.org',
  })

  // claude CLI
  const claudeVersion = check('claude --version')
  results.push({
    name: 'claude',
    found: !!claudeVersion,
    version: claudeVersion || undefined,
    message: claudeVersion ? undefined : 'Install Claude Code: npm install -g @anthropic-ai/claude-code',
  })

  // gh CLI
  const ghVersion = check('gh --version')
  let ghAuth = false
  if (ghVersion) {
    const authStatus = check('gh auth status')
    ghAuth = authStatus !== null
  }
  results.push({
    name: 'gh',
    found: !!ghVersion,
    version: ghVersion?.match(/gh version ([\d.]+)/)?.[1],
    authenticated: ghAuth,
    message: !ghVersion
      ? 'Install GitHub CLI: https://cli.github.com — required for PR creation'
      : !ghAuth
        ? 'Run: gh auth login — required for PR creation'
        : undefined,
  })

  // npm
  const npmVersion = check('npm --version')
  results.push({
    name: 'npm',
    found: !!npmVersion,
    version: npmVersion || undefined,
  })

  return results
}

export function printPrerequisites(results: PrereqResult[]) {
  console.log(chalk.bold('\nPrerequisites\n'))

  const required = ['git', 'node', 'claude']
  const recommended = ['gh', 'npm']

  for (const r of results) {
    const isRequired = required.includes(r.name)
    const icon = r.found ? chalk.green('✓') : isRequired ? chalk.red('✗') : chalk.yellow('!')
    const ver = r.version ? chalk.dim(` (${r.version})`) : ''
    const auth = r.authenticated === false ? chalk.yellow(' — not authenticated') : r.authenticated ? chalk.dim(' — authenticated') : ''
    const label = isRequired ? r.name : `${r.name} ${chalk.dim('(recommended)')}`

    console.log(`  ${icon} ${label}${ver}${auth}`)
    if (r.message) {
      console.log(chalk.dim(`    ${r.message}`))
    }
  }

  const missing = results.filter(r => !r.found && required.includes(r.name))
  if (missing.length > 0) {
    console.log(chalk.red(`\nMissing required tools: ${missing.map(r => r.name).join(', ')}`))
    console.log(chalk.red('Install them before continuing.\n'))
    return false
  }

  // Warn about gh auth
  const gh = results.find(r => r.name === 'gh')
  if (gh && gh.found && !gh.authenticated) {
    console.log(chalk.yellow('\nNote: gh CLI is not authenticated. PR creation will fail until you run: gh auth login'))
  }

  console.log()
  return true
}

export function getEnvironmentNotes(): string[] {
  const notes: string[] = []

  notes.push('Environment expectations for agents:')
  notes.push('')
  notes.push('Required:')
  notes.push('  - git: configured with credentials for cloning repos (SSH key or HTTPS token)')
  notes.push('  - claude: authenticated (run `claude` interactively once to set up)')
  notes.push('  - node + npm: for project setup commands (npm ci, etc.)')
  notes.push('')
  notes.push('For PR creation:')
  notes.push('  - gh: authenticated via `gh auth login` (used by pr-creator agent)')
  notes.push('  - Git push access to the target repos')
  notes.push('')
  notes.push('Optional integrations:')
  notes.push('  - JIRA: set JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN env vars')
  notes.push('         or authenticate via: npm install -g jira-cli && jira login')
  notes.push('  - Linear: set LINEAR_API_KEY env var')
  notes.push('  - Slack: set SLACK_WEBHOOK_URL for notifications')

  return notes
}
