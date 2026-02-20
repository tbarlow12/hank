export interface ProjectConfig {
  name: string
  repo: string
  main_branch: string
  branch_prefix: string
  base_dir: string
}

export interface AgentConfig {
  id: string
  path: string
  capabilities: string[]
  setup?: string[]
}

export interface PoolConfig {
  agents: string[]
  requires?: string[]
}

export interface CliToolConfig {
  command: string
  args?: string[]
}

export interface DefaultsConfig {
  model: string
  cli: string
  poll_interval: number
  max_turns: number
  max_budget_usd: number
}

export interface HenryConfig {
  project: ProjectConfig
  defaults: DefaultsConfig
  agents: Record<string, AgentConfig>
  pools: Record<string, PoolConfig>
  cli: Record<string, CliToolConfig>
  setup?: string[]
  fallback_order: string[]
}

export interface InnerLoopConfig {
  on_reject_from: string
  test_prompt: string
  max_iterations: number
}

export interface StageConfig {
  prompt: string
  pool: string
  model?: string
  max_budget_usd?: number
  max_turns?: number
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
  source: string
  created: string
  branch: string
  status: 'pending' | 'in_progress' | 'done' | 'failed'
  stage: string
  attempt: number
  history: string
  assignee: string
  parent?: string  // id of parent item if this was split from one
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
