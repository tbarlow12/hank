export interface ProjectConfig {
  name: string
  repo: string
  main_branch: string
  branch_prefix: string
  setup?: string[]
}

export interface AgentConfig {
  id: string
  base_dir: string
  capabilities: string[]
  setup?: string[]
  // Computed at load time: project name → clone path
  projects: Record<string, string>
}

export interface PoolConfig {
  agents: string[]
  requires?: string[]
}

export interface CliToolConfig {
  command: string
  args?: string[]
  // Model name mapping: intent → CLI-specific model identifier
  // e.g., { fast: "sonnet", balanced: "sonnet", powerful: "opus" } for Claude
  //        { fast: "gpt-4o-mini", balanced: "gpt-4o", powerful: "o3" } for Cursor
  models?: Record<string, string>
}

// Input watchers: bash scripts that run as subprocesses and emit work items
export interface InputWatcherConfig {
  name: string
  command: string              // bash command to run
  args?: string[]
  cwd?: string                 // working directory (defaults to project dir)
  interval?: number            // re-run interval in seconds (0 = run once, stays alive)
  project: string              // which project work items target
  env?: Record<string, string> // extra env vars
  enabled?: boolean            // default true
}

export interface DefaultsConfig {
  model: string
  cli: string
  poll_interval: number
  max_turns: number
  max_budget_usd: number
  allowed_tools?: string[]
  disallowed_tools?: string[]
  permission_mode?: string
}

export interface HankConfig {
  projects: Record<string, ProjectConfig>
  base_dir: string
  defaults: DefaultsConfig
  agents: Record<string, AgentConfig>
  pools: Record<string, PoolConfig>
  cli: Record<string, CliToolConfig>
  inputs?: InputWatcherConfig[]
  setup?: string[]
  fallback_order: string[]
}

// Per-role instructions + skills (used in both global and project configs)
export interface RoleConfig {
  instructions?: string
  skills?: string[]               // paths to skill files (markdown)
  allowed_tools?: string[]
  disallowed_tools?: string[]
}

// .hank.yml in each target repo
export interface HankProjectMeta {
  instructions?: string           // injected for all agents on this project
  roles?: Record<string, RoleConfig>
  skills?: string[]               // global skills loaded for all roles
  setup?: string[]
}

// ~/.hank/config.yml
export interface HankGlobalMeta {
  instructions?: string
  roles?: Record<string, RoleConfig>
  skills?: string[]
}

export interface PrereqResult {
  name: string
  found: boolean
  version?: string
  authenticated?: boolean
  message?: string
}

export interface InnerLoopConfig {
  on_reject_from: string
  test_prompt: string
  max_iterations: number
}

export interface StageConfig {
  prompt: string
  pool: string
  model?: string              // model intent: "fast", "balanced", "powerful", or a raw model name
  max_budget_usd?: number
  max_turns?: number
  allowed_tools?: string[]      // tools allowed without prompting
  disallowed_tools?: string[]   // tools completely removed from context
  permission_mode?: string      // default | plan | bypassPermissions
  transitions: Record<string, string>
  inner_loop?: InnerLoopConfig
}

export interface PipelineConfig {
  stages: Record<string, StageConfig>
  max_attempts: number
}

export type Directive = 'PASS' | 'REJECT' | 'FAIL' | 'SPLIT'

export interface RunResult {
  directive: Directive
  reason?: string
  output: string
  iterations?: number
  pr_url?: string
  splits?: string[]  // raw markdown content for each split work item
}

export interface WorkItem {
  id: string
  title: string
  project: string   // which project/repo this item targets
  source: string
  created: string
  branch: string
  status: 'pending' | 'in_progress' | 'done' | 'failed'
  stage: string
  attempt: number
  history: string
  assignee: string
  parent?: string
}

export interface AgentStatus {
  id: string
  busy: boolean
  currentItem?: string
  lastActivity?: string
}

export interface PipelineState {
  stages: Record<string, WorkItem[]>
  agents: AgentStatus[]
}
