#!/usr/bin/env tsx
import { program } from 'commander'

program
  .name('dp')
  .description('Dispatch — AI agent pipeline orchestrator')
  .version('0.2.0')

program
  .command('watch')
  .description('Poll ideas/plans/work continuously')
  .action(async () => {
    const { startWatching } = await import('./watcher.js')
    try {
      await startWatching()
    } catch (e: any) {
      console.error('Watch failed:', e.message)
      process.exit(1)
    }
  })

program
  .command('status')
  .description('Show agents + pipeline state')
  .action(async () => {
    const { printStatus } = await import('./state.js')
    printStatus()
  })

program
  .command('inject <file>')
  .description('Copy a work item to 1-Ideas/')
  .action(async (file: string) => {
    const { injectItem } = await import('./state.js')
    injectItem(file)
  })

program
  .command('run <file>')
  .description('Single idea through full pipeline (plan → execute → PR)')
  .action(async (file: string) => {
    const { resolve } = await import('path')
    const { injectItem } = await import('./state.js')
    const { runSingle } = await import('./watcher.js')
    const filePath = resolve(process.cwd(), file)
    await runSingle(filePath, false)
  })

program
  .command('plan <file>')
  .description('Plan only — idea → plan, no execution')
  .action(async (file: string) => {
    const { resolve } = await import('path')
    const { runSingle } = await import('./watcher.js')
    const filePath = resolve(process.cwd(), file)
    await runSingle(filePath, true)
  })

program.parse()
