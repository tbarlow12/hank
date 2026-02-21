export interface Agent {
  id: string       // "agent-0", "agent-1", etc.
  dir: string      // absolute path to repo clone (e.g. ~/dev/0/land-catalyst)
  role: 'planner' | 'executor'
}

export type Directive = 'PASS' | 'REJECT' | 'FAIL' | 'SPLIT'

export interface RunResult {
  directive: Directive
  reason?: string
  output: string
  session_id?: string
  pr_url?: string
  splits?: string[]
}

export interface WorkItem {
  id: string
  title: string
  status: 'pending' | 'in_progress' | 'done' | 'failed'
  stage: string
  attempt: number
  created: string
  history: string
  assignee: string
  parent?: string
  priority?: number
  sessions?: Record<string, string>
  pr_url?: string
}

export type Stage = '1-Ideas' | '2-Plans' | '3-Work' | '4-Failures' | '5-Done'

export const STAGES: Stage[] = ['1-Ideas', '2-Plans', '3-Work', '4-Failures', '5-Done']
