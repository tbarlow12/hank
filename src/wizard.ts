import { createInterface } from 'readline/promises'
import { existsSync, writeFileSync } from 'fs'
import { resolve, basename } from 'path'
import chalk from 'chalk'
import yaml from 'js-yaml'
import { checkPrerequisites, printPrerequisites, getEnvironmentNotes } from './prerequisites.js'
import { scaffoldGlobalConfig, scaffoldProjectConfig } from './project-config.js'
import { getRoot } from './config.js'

const rl = createInterface({ input: process.stdin, output: process.stdout })

async function ask(prompt: string, defaultVal?: string): Promise<string> {
  const suffix = defaultVal ? chalk.dim(` [${defaultVal}]`) : ''
  const answer = await rl.question(`${prompt}${suffix}: `)
  return answer.trim() || defaultVal || ''
}

async function confirm(prompt: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? 'Y/n' : 'y/N'
  const answer = await rl.question(`${prompt} (${hint}): `)
  if (!answer.trim()) return defaultYes
  return answer.trim().toLowerCase().startsWith('y')
}

interface RepoEntry {
  url: string
  name: string
  mainBranch: string
  setup: string[]
  skills: SkillEntry[]
}

interface SkillEntry {
  role: string   // 'all' or a specific role name
  path: string   // path to skill file
}

const ROLES = ['planner', 'reviewer', 'builder', 'tester', 'code-reviewer', 'pr-creator']

export async function runWizard() {
  const root = getRoot()

  console.log(chalk.bold('\nHank Setup Wizard\n'))
  console.log('This will configure Hank for your projects and set up agent clones.\n')

  // Prerequisites check
  const prereqs = checkPrerequisites()
  printPrerequisites(prereqs)

  const required = prereqs.filter(r => ['git', 'node', 'claude'].includes(r.name))
  if (required.some(r => !r.found)) {
    console.log(chalk.red('Fix the missing prerequisites above before continuing.'))
    rl.close()
    process.exit(1)
  }

  // Show environment notes
  console.log(chalk.bold('Environment Notes\n'))
  for (const line of getEnvironmentNotes()) {
    console.log(chalk.dim(`  ${line}`))
  }
  console.log()

  if (!await confirm('Continue with setup?')) {
    rl.close()
    return
  }

  // --- Scaffold global config ---
  scaffoldGlobalConfig()
  console.log(chalk.dim('\n  Global config: ~/.hank/config.yml'))

  // --- Collect repos ---
  console.log(chalk.bold('\nRepositories\n'))
  console.log('Add the repositories you want Hank to manage.')
  console.log('Each agent will get its own clone of every repo.\n')

  const repos: RepoEntry[] = []
  let addMore = true

  while (addMore) {
    const url = await ask('Repository URL (SSH or HTTPS)')
    if (!url) {
      if (repos.length === 0) {
        console.log(chalk.yellow('You need at least one repository.'))
        continue
      }
      break
    }

    // Derive name from URL
    const inferredName = basename(url).replace(/\.git$/, '')
    const name = await ask('  Project name', inferredName)
    const mainBranch = await ask('  Main branch', 'main')

    // Setup commands
    console.log(chalk.dim('  Setup commands run after cloning (e.g., npm ci, pip install -r requirements.txt)'))
    const setupCmds: string[] = []
    let addCmd = true
    while (addCmd) {
      const cmd = await ask('  Setup command (blank to finish)')
      if (!cmd) { addCmd = false } else { setupCmds.push(cmd) }
    }

    // Skills
    console.log()
    console.log(chalk.bold(`  Skills for ${name}\n`))
    console.log('  Skills are markdown files with instructions for specific agent roles.')
    console.log('  They live in the repo (e.g., .claude/skills/testing.md) or globally (~/.hank/skills/).')
    console.log('  The repo\'s CLAUDE.md is always loaded automatically — skills add role-specific context.')
    console.log(chalk.dim(`  Roles: ${ROLES.join(', ')}`))
    console.log()

    const skills: SkillEntry[] = []
    const wantSkills = await confirm('  Add skills for this project?', false)
    if (wantSkills) {
      let addSkill = true
      while (addSkill) {
        const path = await ask('  Skill file path (e.g., .claude/skills/testing.md)')
        if (!path) { addSkill = false; continue }

        const roleInput = await ask('  Which role(s)? (all, or comma-separated: builder,tester)', 'all')
        const roleList = roleInput === 'all' ? ['all'] : roleInput.split(',').map(s => s.trim())

        for (const role of roleList) {
          skills.push({ role, path })
        }
        console.log(chalk.green(`    + ${path} -> ${roleList.join(', ')}`))
      }
    }

    repos.push({ url, name, mainBranch, setup: setupCmds, skills })
    console.log(chalk.green(`  Added ${name}`))
    console.log()

    addMore = await confirm('Add another repository?', false)
  }

  // --- Agent count ---
  console.log(chalk.bold('\nAgents\n'))
  console.log('Each agent is an isolated workspace with its own clone of every repo.')
  console.log('More agents = more parallelism, but more disk space and setup time.')
  console.log(chalk.dim(`  Disk per agent: ~1 clone per repo (${repos.length} repo${repos.length > 1 ? 's' : ''})`))
  console.log()

  const agentCountStr = await ask('How many agents?', '3')
  const agentCount = Math.max(1, parseInt(agentCountStr) || 3)

  // --- Base directory ---
  const defaultBase = '.hank/agents'
  const baseDir = await ask('Base directory for agent clones', defaultBase)

  // --- Pool assignment ---
  console.log(chalk.bold('\nPool Assignment\n'))
  console.log('Agents are grouped into pools. The default assignment works well for most setups:')
  console.log(chalk.dim('  - All agents can build'))
  console.log(chalk.dim('  - Agent 1 plans and creates PRs'))
  console.log(chalk.dim(`  - Agent ${agentCount} reviews (if you have 2+ agents)`))
  console.log(chalk.dim('  - Agent 1 runs tests (first agent, likely has full env)'))
  console.log()

  const useDefaults = await confirm('Use default pool assignment?')

  // --- Generate hank.yml ---
  console.log(chalk.bold('\nGenerating configuration...\n'))

  const projects: Record<string, any> = {}
  for (const repo of repos) {
    projects[repo.name] = {
      repo: repo.url,
      main_branch: repo.mainBranch,
      branch_prefix: 'hank/',
      ...(repo.setup.length > 0 ? { setup: repo.setup } : {}),
    }
  }

  const agents: Record<string, any> = {}
  for (let i = 1; i <= agentCount; i++) {
    agents[`agent-${i}`] = {
      base_dir: `${baseDir}/${i}`,
      capabilities: i === 1 ? ['build', 'db', 'containers'] : ['build'],
    }
  }

  const allAgents = Array.from({ length: agentCount }, (_, i) => `agent-${i + 1}`)
  const planner = 'agent-1'
  const reviewer = agentCount >= 2 ? `agent-${agentCount}` : 'agent-1'
  const tester = 'agent-1'
  const prCreator = 'agent-1'

  let pools: Record<string, any>
  if (useDefaults) {
    pools = {
      planners: { agents: [planner] },
      reviewers: { agents: [reviewer] },
      builders: { agents: allAgents },
      testers: { agents: [tester], requires: ['db', 'containers'] },
      'code-reviewers': { agents: [reviewer] },
      'pr-creators': { agents: [prCreator] },
    }
  } else {
    pools = {}
    const poolNames = ['planners', 'reviewers', 'builders', 'testers', 'code-reviewers', 'pr-creators']
    for (const pool of poolNames) {
      const defaultVal = pool === 'builders' ? allAgents.map((_, i) => i + 1).join(',') : '1'
      const input = await ask(`  Agents for ${pool} (comma-separated, e.g. 1,2,3)`, defaultVal)
      const ids = input.split(',').map(s => `agent-${s.trim()}`).filter(id => agents[id])
      pools[pool] = { agents: ids }
      if (pool === 'testers') pools[pool].requires = ['db', 'containers']
    }
  }

  const hankConfig: Record<string, any> = {
    projects,
    base_dir: baseDir,
    defaults: {
      model: 'sonnet',
      cli: 'claude',
      poll_interval: 5,
      max_turns: 50,
      max_budget_usd: 5,
      disallowed_tools: ['Bash(git push *)', 'Bash(rm -rf *)', 'Bash(curl *)'],
    },
    setup: repos.length > 0 && repos[0].setup.length > 0 ? repos[0].setup : ['npm ci'],
    agents,
    pools,
    cli: {
      claude: { command: 'claude', args: ['--print'] },
      cursor: { command: 'cursor' },
    },
    fallback_order: ['claude', 'cursor'],
  }

  const configPath = resolve(root, 'hank.yml')
  writeFileSync(configPath, yaml.dump(hankConfig, { lineWidth: 120, noRefs: true }), 'utf-8')
  console.log(chalk.green(`  hank.yml`))

  // --- Generate .hank.yml for each project ---
  for (const repo of repos) {
    const projectConfig = buildProjectConfig(repo)
    // We can't write to the actual repo yet (not cloned), so we store them
    // in a staging area and copy them after cloning
    const stagingPath = resolve(root, '.hank-staging', `${repo.name}.hank.yml`)
    const stagingDir = resolve(root, '.hank-staging')
    const { mkdirSync } = await import('fs')
    mkdirSync(stagingDir, { recursive: true })
    writeFileSync(stagingPath, yaml.dump(projectConfig, { lineWidth: 120, noRefs: true }), 'utf-8')
    console.log(chalk.green(`  .hank-staging/${repo.name}.hank.yml (will be copied to repo after clone)`))
  }

  // pipeline.yml
  const pipelinePath = resolve(root, 'pipeline.yml')
  if (existsSync(pipelinePath)) {
    console.log(chalk.green(`  pipeline.yml (existing)`))
  }

  // --- Summary ---
  console.log(chalk.bold('\nSummary\n'))
  console.log(`  Projects:  ${repos.map(r => chalk.cyan(r.name)).join(', ')}`)
  console.log(`  Agents:    ${agentCount}`)
  console.log(`  Base dir:  ${chalk.dim(baseDir)}`)
  console.log(`  Pools:`)
  for (const [name, pool] of Object.entries(pools)) {
    console.log(chalk.dim(`    ${name}: [${(pool as any).agents.join(', ')}]`))
  }
  for (const repo of repos) {
    if (repo.skills.length > 0) {
      console.log(`  Skills (${repo.name}):`)
      for (const s of repo.skills) {
        console.log(chalk.dim(`    ${s.path} -> ${s.role}`))
      }
    }
  }
  console.log()

  console.log(chalk.bold('  Config layers:'))
  console.log(chalk.dim('    ~/.hank/config.yml      — global instructions + skills'))
  console.log(chalk.dim('    <repo>/.hank.yml        — project-specific role instructions + skills'))
  console.log(chalk.dim('    <repo>/CLAUDE.md          — auto-loaded by Claude Code (repo context)'))
  console.log(chalk.dim('    agents/*.md               — base role prompts (planner, builder, etc.)'))
  console.log()

  const proceed = await confirm('Proceed with cloning repos and running setup?')
  rl.close()

  if (!proceed) {
    console.log(chalk.dim('Config written. Run `hank init` again when ready to clone.'))
    return
  }

  return true
}

function buildProjectConfig(repo: RepoEntry): Record<string, any> {
  const config: Record<string, any> = {}

  config.instructions = `# ${repo.name}\n# Add project-specific instructions that apply to all agents here.`

  // Build roles from skills
  const roles: Record<string, any> = {}
  const globalSkills: string[] = []

  for (const skill of repo.skills) {
    if (skill.role === 'all') {
      globalSkills.push(skill.path)
    } else {
      if (!roles[skill.role]) roles[skill.role] = { skills: [] }
      roles[skill.role].skills.push(skill.path)
    }
  }

  // Ensure all standard roles have entries
  for (const role of ROLES) {
    if (!roles[role]) roles[role] = {}
    roles[role].instructions = roles[role].instructions || ''
  }

  config.roles = roles
  if (globalSkills.length > 0) config.skills = globalSkills

  return config
}
