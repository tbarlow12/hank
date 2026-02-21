import { mkdirSync, appendFileSync } from 'fs'
import { resolve } from 'path'
import chalk from 'chalk'
import { LOGS_DIR } from './config.js'

function ensureDir(dir: string) {
  mkdirSync(dir, { recursive: true })
}

function ts(): string {
  return new Date().toISOString()
}

export function logStage(stage: string, msg: string) {
  const dir = resolve(LOGS_DIR, 'stages')
  ensureDir(dir)
  appendFileSync(resolve(dir, `${stage}.log`), `[${ts()}] ${msg}\n`)
  console.log(chalk.dim(`[${stage}]`), msg)
}

export function logItem(itemId: string, stage: string, agent: string, msg: string) {
  const dir = resolve(LOGS_DIR, 'items')
  ensureDir(dir)
  appendFileSync(resolve(dir, `${itemId}.log`), `[${ts()}] [${stage}] [${agent}] ${msg}\n`)
  console.log(chalk.dim(`[${itemId}]`), chalk.blue(`[${agent}]`), msg)
}

export function logError(msg: string) {
  console.error(chalk.red('ERROR:'), msg)
}

export function logInfo(msg: string) {
  console.log(chalk.green('>>'), msg)
}
