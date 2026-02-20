# Hank — AI CLI Agent Orchestration Framework

## What is this?

Hank is a file-based pipeline orchestrator for AI coding agents. Write a rough idea, drop it in a directory, and a chain of specialized agents (planner → reviewer → builder → tester → code reviewer → PR creator) processes it through to a draft PR.

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
- `hank.yml` — Agent/pool/CLI configuration
- `pipeline.yml` — Declarative pipeline stages + transitions
- `pipeline/` — Runtime work item directories (gitignored)
- `locks/` — File locks (gitignored)
- `logs/` — Execution logs (gitignored)

## Key Commands

| Command | Description |
|---------|-------------|
| `hank init` | Clone repos, run setup, create directories |
| `hank start [stage]` | Launch watchers (all or specific stage) |
| `hank stop` | Stop watchers (Ctrl+C) |
| `hank status` | Show pipeline state |
| `hank inject <file>` | Add work item to drafts/ |
| `hank logs [target]` | Tail logs for a stage or item |
| `hank retry <id>` | Requeue a failed item |
| `hank dashboard` | Launch web dashboard |

## Work Item Format

Markdown files with YAML frontmatter: id, title, source, status, stage, attempt, history, assignee. Sections: Description, Plan, Review Notes, Build Log, Test Results, Code Review.

## Config

- `hank.yml` — Agents, pools, CLI tools, setup commands
- `pipeline.yml` — Stages, transitions (PASS/REJECT/FAIL routing), inner loops

## Development

```bash
npx tsx src/cli.ts <command>   # run in dev
npm run build                  # compile to dist/
```
