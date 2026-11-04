import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPrompt } from './opencode-agent.js';
import { readResultFromOutput } from './mock-agent.js';
import type { JobFile } from '../../shared/job-contract.js';
import { makeTempDir } from '../testing/harness.js';

const jobFile: JobFile = {
  schema: 1,
  job_id: 'job_test',
  event: { id: 'evt_1', title: 'درس', kind: 'lesson', date: '2026-11-04' },
  inputs: { SOURCE_VIDEO: '10_events/x/source/main.mp4' },
  style: { id: 'sample-reel', version: '1.0.0', params: {} },
  output: { dir: '10_events/x/output/job_test', required: ['final.mp4', 'result.json'] },
  limits: { max_minutes: 30 },
};

describe('agent contracts', () => {
  it('builds a prompt with the job file and hard boundaries', () => {
    const prompt = buildPrompt(jobFile, 'work/job.json', 'output/job');
    expect(prompt).toContain('work/job.json');
    expect(prompt).toContain('output/job');
    expect(prompt).toContain('final.mp4');
    expect(prompt).toContain('result.json');
    expect(prompt).toContain('لا تنقل أو تحذف');
  });

  it('rejects a missing or invalid result.json', () => {
    const dir = makeTempDir('agent-result-');
    expect(() => readResultFromOutput(dir)).toThrow();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'result.json'), '{"ok":false,"outputs":[]}');
    expect(() => readResultFromOutput(dir)).toThrow();
    writeFileSync(
      join(dir, 'result.json'),
      JSON.stringify({ ok: true, outputs: [{ path: 'final.mp4' }] }),
    );
    expect(readResultFromOutput(dir).ok).toBe(true);
  });
});
