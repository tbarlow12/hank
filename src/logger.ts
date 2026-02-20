import { mkdirSync, appendFileSync } from 'fs'
import { resolve } from 'path'
import chalk from 'chalk'
import { getRoot } from './config.js'

function ensureDir(dir: string) {
  mkdirSync(dir, { recursive: true })
}

function ts(): string {
  return new Date().toISOString()
}

export function logStage(stage: string, msg: string) {
  const dir = resolve(getRoot(), 'logs/stages')
  ensureDir(dir)
  const line = `[${ts()}] ${msg}\n`
  appendFileSync(resolve(dir, `${stage}.log`), line)
  console.log(chalk.dim(`[${stage}]`), msg)
}

export function logItem(itemId: string, stage: string, agent: string, msg: string) {
  const dir = resolve(getRoot(), 'logs/items')
  ensureDir(dir)
  const line = `[${ts()}] [${stage}] [${agent}] ${msg}\n`
  appendFileSync(resolve(dir, `${itemId}.log`), line)
  console.log(chalk.dim(`[${itemId}]`), chalk.blue(`[${agent}]`), msg)
}

export function logError(msg: string) {
  console.error(chalk.red('ERROR:'), msg)
}

export function logInfo(msg: string) {
  console.log(chalk.green('>>'), msg)
}
