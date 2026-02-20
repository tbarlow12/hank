import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs'
import { resolve, dirname, isAbsolute } from 'path'
import { tmpdir } from 'os'
import yaml from 'js-yaml'
import type { HankGlobalMeta, HankProjectMeta, RoleConfig } from './types.js'

const HOME = process.env.HOME || '~'
const GLOBAL_CONFIG_PATH = resolve(HOME, '.hank/config.yml')

/** Map pipeline stage names to role names used in .hank.yml */
const STAGE_TO_ROLE: Record<string, string> = {
  drafts: 'planner',
  plans: 'planner',
  review: 'reviewer',
  build: 'builder',
  test: 'tester',
  'code-review': 'code-reviewer',
  'draft-pr': 'pr-creator',
}

export function loadGlobalMeta(): HankGlobalMeta {
  if (!existsSync(GLOBAL_CONFIG_PATH)) return {}
  try {
    const raw = readFileSync(GLOBAL_CONFIG_PATH, 'utf-8')
    return (yaml.load(raw) as HankGlobalMeta) || {}
  } catch {
    return {}
  }
}

export function loadProjectMeta(projectDir: string): HankProjectMeta {
  const candidates = [
    resolve(projectDir, '.hank.yml'),
    resolve(projectDir, '.hank.yaml'),
    resolve(projectDir, '.hank/config.yml'),
  ]
  for (const path of candidates) {
    if (existsSync(path)) {
      try {
        const raw = readFileSync(path, 'utf-8')
        return (yaml.load(raw) as HankProjectMeta) || {}
      } catch {
        continue
      }
    }
  }
  return {}
}

/**
 * Build a combined system prompt file for an agent invocation.
 * Merges: base agent prompt + global instructions + project instructions + skill files.
 * Returns path to a temp file containing the combined prompt.
 */
export function buildSystemPrompt(
  agentPromptFile: string,
  stageName: string,
  projectDir: string,
): string {
  const role = STAGE_TO_ROLE[stageName] || stageName
  const global = loadGlobalMeta()
  const project = loadProjectMeta(projectDir)

  const parts: string[] = []

  // 1. Base agent role prompt — resolution order:
  //    a) project .hank.yml roles.<role>.prompt (relative to project dir)
  //    b) ~/.hank/agents/<role>.md (user's customized copy)
  //    c) Hank default from pipeline.yml (agentPromptFile)
  const basePromptFile = resolveAgentPrompt(role, project, projectDir, agentPromptFile)
  parts.push(readFileSync(basePromptFile, 'utf-8'))

  // 2. Global instructions
  if (global.instructions) {
    parts.push('---\n\n# Global Instructions\n\n' + global.instructions)
  }

  // 3. Global role-specific instructions
  const globalRole = global.roles?.[role]
  if (globalRole?.instructions) {
    parts.push('## Global Role Instructions\n\n' + globalRole.instructions)
  }

  // 4. Project instructions
  if (project.instructions) {
    parts.push('---\n\n# Project Instructions\n\n' + project.instructions)
  }

  // 5. Project role-specific instructions
  const projectRole = project.roles?.[role]
  if (projectRole?.instructions) {
    parts.push('## Project Role Instructions\n\n' + projectRole.instructions)
  }

  // 6. Resolve and inline skill files
  const skillPaths = collectSkills(global, project, role, projectDir)
  for (const skillPath of skillPaths) {
    if (existsSync(skillPath)) {
      const content = readFileSync(skillPath, 'utf-8')
      parts.push(`---\n\n# Skill: ${skillPath}\n\n${content}`)
    }
  }

  // Write combined prompt to temp file
  const combined = parts.join('\n\n')
  const tmpDir = resolve(tmpdir(), 'hank-prompts')
  mkdirSync(tmpDir, { recursive: true })
  const tmpFile = resolve(tmpDir, `${role}-${Date.now()}.md`)
  writeFileSync(tmpFile, combined, 'utf-8')

  return tmpFile
}

/** Resolve which agent prompt file to use for a role */
function resolveAgentPrompt(
  role: string,
  project: HankProjectMeta,
  projectDir: string,
  defaultPromptFile: string,
): string {
  // Project-level override
  const projectOverride = project.roles?.[role]?.prompt
  if (projectOverride) {
    const p = resolve(projectDir, projectOverride)
    if (existsSync(p)) return p
  }

  // User's global agents directory
  const globalPrompt = resolve(HOME, '.hank', 'agents', `${role}.md`)
  if (existsSync(globalPrompt)) return globalPrompt

  // Hank default
  return defaultPromptFile
}

/** Collect and dedupe skill file paths from global + project configs */
function collectSkills(
  global: HankGlobalMeta,
  project: HankProjectMeta,
  role: string,
  projectDir: string,
): string[] {
  const paths = new Set<string>()

  const resolveSkill = (s: string, baseDir: string) => {
    if (isAbsolute(s)) return s
    if (s.startsWith('~/')) return resolve(HOME, s.slice(2))
    return resolve(baseDir, s)
  }

  // Global skills (all roles)
  for (const s of global.skills || []) {
    paths.add(resolveSkill(s, HOME))
  }

  // Global role skills
  for (const s of global.roles?.[role]?.skills || []) {
    paths.add(resolveSkill(s, HOME))
  }

  // Project skills (all roles)
  for (const s of project.skills || []) {
    paths.add(resolveSkill(s, projectDir))
  }

  // Project role skills
  for (const s of project.roles?.[role]?.skills || []) {
    paths.add(resolveSkill(s, projectDir))
  }

  return [...paths]
}

/** Get merged tool restrictions from global + project role configs */
export function getRoleToolOverrides(
  stageName: string,
  projectDir: string,
): { allowed?: string[]; disallowed?: string[] } {
  const role = STAGE_TO_ROLE[stageName] || stageName
  const global = loadGlobalMeta()
  const project = loadProjectMeta(projectDir)

  const allowed: string[] = [
    ...(global.roles?.[role]?.allowed_tools || []),
    ...(project.roles?.[role]?.allowed_tools || []),
  ]
  const disallowed: string[] = [
    ...(global.roles?.[role]?.disallowed_tools || []),
    ...(project.roles?.[role]?.disallowed_tools || []),
  ]

  return {
    allowed: allowed.length > 0 ? allowed : undefined,
    disallowed: disallowed.length > 0 ? disallowed : undefined,
  }
}

/** Scaffold a .hank.yml in a project directory */
export function scaffoldProjectConfig(projectDir: string, projectName: string) {
  const configPath = resolve(projectDir, '.hank.yml')
  if (existsSync(configPath)) return // don't overwrite

  const content = `# Hank project config for ${projectName}
# This file tells Hank's agents how to work in this repo.
# It's loaded automatically when agents process work items for this project.

# Instructions injected for ALL agents working on this project
instructions: |
  # Add project-specific instructions here.
  # This is appended to each agent's system prompt alongside the repo's CLAUDE.md.

# Per-role instructions and skills
# Roles: planner, reviewer, builder, tester, code-reviewer, pr-creator
#
# Each role can override the base agent prompt with a project-specific version.
# Base prompts are copied to .hank/agents/ during init — edit those, then set prompt: below.
roles:
  builder:
    # prompt: .hank/agents/builder.md
    instructions: |
      # Add builder-specific instructions.
      # e.g., "Always run npm run lint after changes."
    skills: []
      # - .claude/skills/my-skill.md

  tester:
    # prompt: .hank/agents/tester.md
    instructions: |
      # What commands should the tester run?
      # e.g., "Run: npm test && npm run lint && npx tsc --noEmit"
    skills: []

  planner:
    # prompt: .hank/agents/planner.md
    skills: []
      # - .claude/skills/architecture.md

# Skills loaded for ALL roles on this project
skills: []
  # - .claude/skills/shared.md
`
  writeFileSync(configPath, content, 'utf-8')
}

/** Scaffold the global ~/.hank/config.yml */
export function scaffoldGlobalConfig() {
  const dir = resolve(HOME, '.hank')
  mkdirSync(dir, { recursive: true })
  mkdirSync(resolve(dir, 'skills'), { recursive: true })
  mkdirSync(resolve(dir, 'agents'), { recursive: true })

  if (existsSync(GLOBAL_CONFIG_PATH)) return

  const content = `# Hank global config
# Applies to all projects. Project-level .hank.yml can override/extend.

# Instructions injected for all agents across all projects
instructions: |
  Always use conventional commits (feat:, fix:, refactor:, chore:, test:).
  Never commit secrets, .env files, or credentials.

# Per-role defaults
roles:
  builder:
    instructions: |
      Make small, incremental commits. Each commit should compile.
  code-reviewer:
    instructions: |
      Focus on correctness, security, and maintainability.
      Don't nitpick style if it matches existing patterns.

# Global skills loaded for all projects and roles
# Place skill files in ~/.hank/skills/
skills: []
  # - ~/.hank/skills/code-quality.md
`
  writeFileSync(GLOBAL_CONFIG_PATH, content, 'utf-8')
}
