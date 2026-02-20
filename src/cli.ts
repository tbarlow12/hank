#!/usr/bin/env tsx
import { program } from 'commander'
import { init } from './init.js'

program
  .name('hank')
  .description('AI CLI agent orchestration framework')
  .version('0.1.0')

program
  .command('init')
  .description('Interactive setup wizard — configure repos, agents, clone, and bootstrap')
  .action(async () => {
    try {
      await init()
    } catch (e: any) {
      console.error('Init failed:', e.message)
      process.exit(1)
    }
  })

program
  .command('doctor')
  .description('Check prerequisites and environment')
  .action(async () => {
    const { checkPrerequisites, printPrerequisites, getEnvironmentNotes } = await import('./prerequisites.js')
    const ok = printPrerequisites(checkPrerequisites())
    console.log()
    for (const line of getEnvironmentNotes()) console.log(`  ${line}`)
    console.log()
    process.exit(ok ? 0 : 1)
  })

program
  .command('start [stage]')
  .description('Launch pipeline watchers (all or specific stage)')
  .action(async (stage?: string) => {
    const { startWatchers } = await import('./watcher.js')
    try {
      await startWatchers(stage)
    } catch (e: any) {
      console.error('Start failed:', e.message)
      process.exit(1)
    }
  })

program
  .command('stop')
  .description('Stop all watchers')
  .action(() => {
    // Watchers run in-process; stopping = killing the process
    console.log('Send SIGINT (Ctrl+C) to stop watchers.')
  })

program
  .command('status')
  .description('Show pipeline state')
  .action(async () => {
    const { printStatus } = await import('./state.js')
    printStatus()
  })

program
  .command('inject <file>')
  .description('Add a work item to drafts/')
  .action(async (file: string) => {
    const { injectItem } = await import('./state.js')
    injectItem(file)
  })

program
  .command('logs [target]')
  .description('Tail logs for a stage or item ID')
  .action(async (target?: string) => {
    const { tailLogs } = await import('./state.js')
    tailLogs(target)
  })

program
  .command('retry <itemId>')
  .description('Move a failed item back to its last stage')
  .action(async (itemId: string) => {
    const { retryItem } = await import('./state.js')
    retryItem(itemId)
  })

program
  .command('dashboard')
  .description('Launch local web dashboard')
  .option('-p, --port <port>', 'Port number', '4800')
  .action(async (opts) => {
    const { startDashboard } = await import('./dashboard.js')
    startDashboard(parseInt(opts.port))
  })

program.parse()
