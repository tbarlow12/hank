import type { PipelineConfig, Directive, StageConfig } from './types.js'

export function getNextStage(pipeline: PipelineConfig, currentStage: string, directive: Directive): string {
  const stage = pipeline.stages[currentStage]
  if (!stage) throw new Error(`Unknown stage: ${currentStage}`)

  const target = stage.transitions[directive]
  if (!target) throw new Error(`No transition for ${directive} in stage ${currentStage}`)
  return target
}

export function getStageConfig(pipeline: PipelineConfig, stageName: string): StageConfig {
  const stage = pipeline.stages[stageName]
  if (!stage) throw new Error(`Unknown stage: ${stageName}`)
  return stage
}

export function getStageNames(pipeline: PipelineConfig): string[] {
  return Object.keys(pipeline.stages)
}

export function getAllDirs(pipeline: PipelineConfig): string[] {
  return [...Object.keys(pipeline.stages), 'done', 'failed']
}
