import type { JobFile, ResultFile } from '../../shared/job-contract.js';

export interface AgentJobPaths {
  volumeRoot: string;
  eventDir: string;
  workDir: string;
  outputDir: string;
  jobFileRel: string;
  workRel: string;
  outputRel: string;
}

export interface AgentRunContext {
  jobId: string;
  jobFile: JobFile;
  paths: AgentJobPaths;
  signal: AbortSignal;
  onProgress(progress: number, step: string): void;
  onLog(level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: unknown): void;
}

export interface AgentRunResult {
  result: ResultFile;
  sessionId: string | null;
}

export interface AgentAdapter {
  readonly id: string;
  isAvailable(): Promise<boolean>;
  run(context: AgentRunContext): Promise<AgentRunResult>;
}
