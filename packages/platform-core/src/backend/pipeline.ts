import type { BackendPipeline, BackendPipelineStage } from '../contracts/backend/pipeline.js';

export class PipelineImpl implements BackendPipeline {
  private stages = new Map<string, BackendPipelineStage[]>();

  register(pipeName: string, stage: BackendPipelineStage): void {
    if (!this.stages.has(pipeName)) {
      this.stages.set(pipeName, []);
    }
    this.stages.get(pipeName)?.push(stage);
  }

  async execute<T = unknown>(pipeName: string, input: T): Promise<T> {
    const pipeStages = this.stages.get(pipeName) ?? [];
    let result: unknown = input;
    for (const stage of pipeStages) {
      result = await stage.handler(result);
    }
    return result as T;
  }
}
