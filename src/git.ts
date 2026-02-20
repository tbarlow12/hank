import { execSync } from 'child_process'

function run(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, stdio: 'pipe', encoding: 'utf-8' }).trim()
}

export function createBranch(agentPath: string, branchName: string, mainBranch: string = 'main') {
  run(`git fetch origin`, agentPath)
  run(`git checkout ${mainBranch}`, agentPath)
  run(`git pull origin ${mainBranch}`, agentPath)
  run(`git checkout -b ${branchName}`, agentPath)
}

export function checkoutBranch(agentPath: string, branchName: string) {
  run(`git fetch origin`, agentPath)
  try {
    run(`git checkout ${branchName}`, agentPath)
  } catch {
    run(`git checkout -b ${branchName}`, agentPath)
  }
}

export function pushBranch(agentPath: string, branchName: string) {
  run(`git push origin ${branchName}`, agentPath)
}

export function getCurrentBranch(agentPath: string): string {
  return run('git branch --show-current', agentPath)
}

export function getDiff(agentPath: string, baseBranch: string = 'main'): string {
  return run(`git diff ${baseBranch}...HEAD`, agentPath)
}

export function resetToMain(agentPath: string, mainBranch: string = 'main') {
  run(`git checkout ${mainBranch}`, agentPath)
  run(`git pull origin ${mainBranch}`, agentPath)
}
