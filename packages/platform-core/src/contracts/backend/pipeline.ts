export interface BackendPipelineStage {
  name: string;
  handler: (input: unknown) => Promise<unknown>;
}

export interface BackendPipeline {
  register(pipeName: string, stage: BackendPipelineStage): void;
  execute<T = unknown>(pipeName: string, input: T): Promise<T>;
}
