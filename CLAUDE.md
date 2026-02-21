# Dispatch (`dp`) — AI Agent Pipeline Orchestrator

## What is this?

Dispatch is a file-based pipeline orchestrator for AI coding agents. Write a rough idea, drop it in a directory, and a chain of specialized agents (planner → executor) processes it through to a draft PR.

## Pipeline

```
1-Ideas → (plan on agent 0) → 2-Plans → (execute+PR on agent N) → 3-Work → (PR merged) → 5-Done
                                                                      ↘ 4-Failures
```

## Quick Start

```bash
npm install
npx tsx src/cli.ts status       # show agents + pipeline state
npx tsx src/cli.ts inject idea.md  # add a work item
npx tsx src/cli.ts plan idea.md    # plan only
npx tsx src/cli.ts run idea.md     # full pipeline: plan → execute → PR
npx tsx src/cli.ts watch           # continuous polling
```

## Commands

| Command | Description |
|---------|-------------|
| `dp watch` | Poll ideas/plans/work continuously |
| `dp status` | Show agents + pipeline state |
| `dp inject <file>` | Copy to 1-Ideas/ |
| `dp plan <file>` | Plan only (idea → plan) |
| `dp run <file>` | Single idea through full pipeline |

## Project Structure

```
src/
├── cli.ts          # dp watch|status|inject|run|plan
├── config.ts       # Auto-detect agents, constants
├── runner.ts       # Spawn claude --print with cwd
├── watcher.ts      # Three-phase poll loop
├── mover.ts        # File transitions between dirs
├── state.ts        # Status display + inject
├── claim.ts        # File locking
├── frontmatter.ts  # YAML frontmatter
├── logger.ts       # Logging
└── types.ts        # Types
agents/
├── planner.md      # Plan stage prompt
└── executor.md     # Execute+PR stage prompt
```

## Agents

Auto-detected from `~/dev/N/land-catalyst`:
- **Agent 0** = planner (read-only exploration, uses opus)
- **Agents 1+** = executors (implement + PR, uses sonnet)

## Work Item Format

Markdown files with YAML frontmatter: id, title, status, stage, attempt, history, assignee. Sections: Description, Plan, Execution Log, Feedback.

## Development

```bash
npx tsx src/cli.ts <command>   # run in dev
npm run build                  # compile to dist/
```
