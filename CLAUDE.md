# Henry — AI CLI Agent Orchestration Framework

## What is this?

Henry is a file-based pipeline orchestrator for AI coding agents. Write a rough idea, drop it in a directory, and a chain of specialized agents (planner → reviewer → builder → tester → code reviewer → PR creator) processes it through to a draft PR.

## Quick Start

```bash
npm install
npx tsx src/cli.ts init          # bootstrap dirs + clone agent repos
npx tsx src/cli.ts inject idea.md # add a work item
npx tsx src/cli.ts start          # launch pipeline watchers
npx tsx src/cli.ts dashboard      # open web dashboard at :4800
npx tsx src/cli.ts status         # show pipeline state
```

## Project Structure

- `src/` — TypeScript source (CLI, pipeline engine, watchers, dashboard)
- `agents/` — Prompt templates for each pipeline stage
- `henry.yml` — Agent/pool/CLI configuration
- `pipeline.yml` — Declarative pipeline stages + transitions
- `pipeline/` — Runtime work item directories (gitignored)
- `locks/` — File locks (gitignored)
- `logs/` — Execution logs (gitignored)

## Key Commands

| Command | Description |
|---------|-------------|
| `henry init` | Clone repos, run setup, create directories |
| `henry start [stage]` | Launch watchers (all or specific stage) |
| `henry stop` | Stop watchers (Ctrl+C) |
| `henry status` | Show pipeline state |
| `henry inject <file>` | Add work item to drafts/ |
| `henry logs [target]` | Tail logs for a stage or item |
| `henry retry <id>` | Requeue a failed item |
| `henry dashboard` | Launch web dashboard |

## Work Item Format

Markdown files with YAML frontmatter: id, title, source, status, stage, attempt, history, assignee. Sections: Description, Plan, Review Notes, Build Log, Test Results, Code Review.

## Config

- `henry.yml` — Agents, pools, CLI tools, setup commands
- `pipeline.yml` — Stages, transitions (PASS/REJECT/FAIL routing), inner loops

## Development

```bash
npx tsx src/cli.ts <command>   # run in dev
npm run build                  # compile to dist/
```
