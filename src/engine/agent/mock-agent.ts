import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseResultFile, type ResultFile } from '../../shared/job-contract.js';
import { AppError } from '../../shared/errors.js';
import type { AgentAdapter, AgentRunContext, AgentRunResult } from './types.js';

/**
 * وكيل تجريبي: يمشي مسار الوظيفة كاملًا وينتج ملفات وهمية و result.json صالحًا.
 * الغرض: اختبار الطابور والمراجعة والواجهة بلا OpenCode أو أدوات مونتاج.
 */
export class MockAgentAdapter implements AgentAdapter {
  readonly id = 'mock';

  constructor(private readonly delayMs: number) {}

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async run(context: AgentRunContext): Promise<AgentRunResult> {
    const steps: Array<{ progress: number; label: string }> = [
      { progress: 10, label: 'قراءة المهمة' },
      { progress: 35, label: 'تحليل المصدر' },
      { progress: 65, label: 'توليد المخرجات (وضع تجريبي)' },
      { progress: 90, label: 'كتابة النتيجة' },
    ];
    for (const step of steps) {
      this.throwIfAborted(context);
      context.onProgress(step.progress, step.label);
      context.onLog('info', step.label);
      await delay(this.delayMs, context.signal);
    }

    mkdirSync(context.paths.outputDir, { recursive: true });
    const required = context.jobFile.output.required.filter((name) => name !== 'result.json');
    const outputs: ResultFile['outputs'] = [];

    const source = firstSource(context);
    for (const name of required) {
      const destination = join(context.paths.outputDir, safeOutputName(name));
      if (!existsSync(destination)) {
        if (source && source.toLowerCase().endsWith('.mp4') && statSync(source).size < 50 * 1024 * 1024) {
          copyFileSync(source, destination);
        } else {
          writeFileSync(destination, `Workspace mock output: ${name}\n`, 'utf8');
        }
      }
      outputs.push({
        path: safeOutputName(name),
        duration: 30,
        width: 1080,
        height: 1920,
        fps: 30,
      });
    }

    const result: ResultFile = {
      ok: true,
      outputs,
      style: context.jobFile.style.id,
      warnings: ['تشغيل تجريبي: لم يُنفَّذ مونتاج حقيقي.'],
      needs_review: ['استبدل الأسلوب التجريبي بأسلوب فعلي قبل النشر.'],
    };
    writeFileSync(
      join(context.paths.outputDir, 'result.json'),
      `${JSON.stringify(result, null, 2)}\n`,
      'utf8',
    );
    context.onProgress(100, 'اكتمل');
    return { result, sessionId: null };
  }

  private throwIfAborted(context: AgentRunContext): void {
    if (context.signal.aborted) throw new AppError('WS-5004');
  }
}

export function readResultFromOutput(outputDir: string): ResultFile {
  const file = join(outputDir, 'result.json');
  if (!existsSync(file)) throw new AppError('WS-5007', { reason: 'result_missing', file });
  try {
    return parseResultFile(JSON.parse(readFileSync(file, 'utf8')));
  } catch (error) {
    throw new AppError('WS-5007', { reason: 'result_invalid' }, error);
  }
}

function firstSource(context: AgentRunContext): string | null {
  const inputs = context.jobFile.inputs as Record<string, unknown>;
  const candidate = inputs.SOURCE_VIDEO;
  if (typeof candidate === 'string' && candidate.length > 0) {
    const absolute = join(
      context.paths.volumeRoot,
      ...candidate.split('/').filter((part) => part.length > 0),
    );
    if (existsSync(absolute)) return absolute;
  }
  return null;
}

export function safeOutputName(name: string): string {
  const file = basename(name);
  if (file !== name || file.includes('..') || !/^[a-zA-Z0-9._-]+$/.test(file)) {
    throw new AppError('WS-5007', { reason: 'unsafe_output_path', name });
  }
  return file;
}

export function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new AppError('WS-5004'));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, Math.max(0, ms));
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new AppError('WS-5004'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
