import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppError } from '../../shared/errors.js';
import type { AgentAdapter, AgentRunContext } from '../agent/types.js';
import type { Logger } from '../util/logger.js';
import type { JobFile } from '../../shared/job-contract.js';
import { readResultFromOutput } from './mock-agent.js';

export interface OpencodeAdapterOptions {
  baseUrl: string;
  model: string | null;
  logger: Logger;
}

/**
 * محوّل OpenCode المحلي. يفترض خادمًا يعمل على baseUrl (افتراضيًا 127.0.0.1:4096).
 * العقد: POST /session ثم POST /session/:id/message ثم قراءة result.json.
 * أي تغيير في واجهة OpenCode يُعالَج هنا فقط.
 */
export class OpenCodeAdapter implements AgentAdapter {
  readonly id = 'opencode';

  constructor(private readonly options: OpencodeAdapterOptions) {}

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.base()}/session`, {
        method: 'GET',
        signal: AbortSignal.timeout(4000),
      });
      return response.status < 500;
    } catch {
      return false;
    }
  }

  async run(context: AgentRunContext): Promise<{
    result: ReturnType<typeof readResultFromOutput>;
    sessionId: string | null;
  }> {
    const base = this.base();
    context.onProgress(5, 'إنشاء جلسة الوكيل');
    const session = await this.request(base, '/session', {
      method: 'POST',
      body: { title: `Workspace ${context.jobId}` },
      signal: context.signal,
    });
    const sessionId = extractSessionId(session);
    if (!sessionId) throw new AppError('WS-5010', { reason: 'no_session_id' });
    context.onLog('info', `OpenCode session: ${sessionId}`);

    const prompt = buildPrompt(context.jobFile, context.paths.jobFileRel, context.paths.outputRel);
    const body: Record<string, unknown> = {
      parts: [{ type: 'text', text: prompt }],
    };
    const model = this.options.model;
    if (model && model.includes('/')) {
      const [providerID, ...rest] = model.split('/');
      body.model = { providerID, modelID: rest.join('/') };
    }
    context.onProgress(15, 'إرسال المهمة إلى الوكيل');
    await this.request(base, `/session/${encodeURIComponent(sessionId)}/message`, {
      method: 'POST',
      body,
      signal: context.signal,
      waitForStream: true,
    });
    context.onProgress(85, 'قراءة مخرجات الوكيل');
    const result = readResultFromOutput(context.paths.outputDir);
    return { result, sessionId };
  }

  private base(): string {
    return this.options.baseUrl.replace(/\/+$/, '');
  }

  private async request(
    base: string,
    path: string,
    options: {
      method: 'POST';
      body: unknown;
      signal: AbortSignal;
      waitForStream?: boolean;
    },
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`${base}${path}`, {
        method: options.method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(options.body),
        signal: options.signal,
      });
    } catch (error) {
      if (options.signal.aborted) throw new AppError('WS-5004');
      throw new AppError('WS-5010', { path }, error);
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new AppError('WS-5010', {
        path,
        status: response.status,
        detail: detail.slice(0, 500),
      });
    }
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('text/event-stream')) {
      await drain(response);
      return null;
    }
    const text = await response.text();
    if (text.length === 0) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
}

function extractSessionId(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id === 'string') return record.id;
  if (typeof record.sessionID === 'string') return record.sessionID;
  if (typeof record.session === 'object' && record.session !== null) {
    const session = record.session as Record<string, unknown>;
    if (typeof session.id === 'string') return session.id;
  }
  return null;
}

async function drain(response: Response): Promise<void> {
  if (!response.body) return;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done } = await reader.read();
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}

export function buildPrompt(jobFile: JobFile, jobFileRel: string, outputRel: string): string {
  return [
    'أنت منفّذ مونتاج داخل تطبيق Workspace.',
    `اقرأ ملف المهمة: ${jobFileRel}`,
    `نفّذ الأسلوب ${jobFile.style.id}@${jobFile.style.version} بالمُدخلات المذكورة حرفيًا.`,
    `كل المخرجات تُكتب داخل: ${outputRel}`,
    `المخرجات المطلوبة: ${jobFile.output.required.join(', ')}`,
    'لا تنقل أو تحذف أي ملف خارج مجلد work/ و output/ الخاص بالمهمة.',
    'لا تنشر ولا تلمس مجلد source/.',
    'اكتب result.json وفق مخطط result.json الإصدار 1، ثم توقف.',
    '',
    'مثال result.json:',
    JSON.stringify(
      {
        ok: true,
        outputs: [{ path: 'final.mp4', duration: 30.2, width: 1080, height: 1920, fps: 30 }],
        loudness: { lufs: -14.1, true_peak: -2.3 },
        style: jobFile.style.id,
        warnings: [],
        needs_review: [],
      },
      null,
      2,
    ),
  ].join('\n');
}

export function readJobFile(file: string): JobFile {
  return JSON.parse(readFileSync(join(file), 'utf8')) as JobFile;
}
