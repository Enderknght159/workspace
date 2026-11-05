import { execFile, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { AppError } from '../../shared/errors.js';
import type { ResultFile } from '../../shared/job-contract.js';
import type { Logger } from '../util/logger.js';
import { readResultFromOutput } from './mock-agent.js';
import type { AgentAdapter, AgentRunContext } from './types.js';

const execFileAsync = promisify(execFile);

export interface OpencodeAdapterOptions {
  command: string;
  model: string | null;
  logger: Logger;
}

interface SessionInfo {
  data?: { id?: string };
  id?: string;
}

/**
 * محوّل OpenCode V2.
 *
 * يستخدم CLI (`opencode api ...`) بدل الاتصال المباشر بالخادم، لأن CLI يعرف
 * كيف يكتشف الخدمة الخلفية ويتوثق معها، بينما HTTP الخام يحتاج توكنًا داخليًا.
 * لا نمرر النص عبر shell: نستدعي الملف التنفيذي مباشرة بقائمة وسائط.
 */
export class OpenCodeAdapter implements AgentAdapter {
  readonly id = 'opencode';

  constructor(private readonly options: OpencodeAdapterOptions) {}

  async isAvailable(): Promise<boolean> {
    const command = resolveCommand(this.options.command);
    if (!command) return false;
    try {
      await this.api(command, ['get', '/api/info'], 8_000);
      return true;
    } catch {
      return false;
    }
  }

  async run(context: AgentRunContext): Promise<{ result: ResultFile; sessionId: string | null }> {
    const command = resolveCommand(this.options.command);
    if (!command) throw new AppError('WS-5010', { reason: 'opencode_not_found' });

    context.onProgress(5, 'إنشاء جلسة OpenCode');
    const body: Record<string, unknown> = {
      title: `Workspace ${context.jobId}`,
      location: { directory: context.paths.eventDir },
      metadata: { workspace_job_id: context.jobId },
    };
    if (this.options.model?.includes('/')) {
      const [providerID, ...rest] = this.options.model.split('/');
      body.model = { providerID, id: rest.join('/') };
    }
    const created = await this.apiJson<SessionInfo>(
      command,
      ['post', '/api/session', '--data', JSON.stringify(body)],
      20_000,
      context.signal,
    );
    const sessionId = created.data?.id ?? created.id ?? null;
    if (!sessionId) throw new AppError('WS-5010', { reason: 'no_session_id' });

    context.onLog('info', `OpenCode session: ${sessionId}`);
    context.onProgress(15, 'إرسال المهمة إلى الوكيل');
    const prompt = buildPrompt(context);
    await this.api(
      command,
      ['post', `/api/session/${encodeURIComponent(sessionId)}/prompt`, '--data', JSON.stringify({ text: prompt })],
      30_000,
      context.signal,
    );

    context.onProgress(30, 'الوكيل يعمل');
    const maxMs = Math.max(1, context.jobFile.limits.max_minutes) * 60_000;
    await this.api(
      command,
      ['post', `/api/experimental/session/${encodeURIComponent(sessionId)}/wait`],
      maxMs,
      context.signal,
    );

    context.onProgress(85, 'قراءة مخرجات الوكيل');
    const result = readResultFromOutput(context.paths.outputDir);
    return { result, sessionId };
  }

  private async api(
    command: string,
    args: string[],
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<string> {
    try {
      const result = await execFileAsync(command, ['api', ...args], {
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024,
        encoding: 'utf8',
        signal,
      });
      return result.stdout;
    } catch (error) {
      if (signal?.aborted) throw new AppError('WS-5004');
      const failure = error as { stderr?: string; message?: string };
      this.options.logger.warn('opencode.api_failed', {
        command: args[0],
        message: failure.message ?? '',
      });
      throw new AppError('WS-5010', {
        reason: 'opencode_api_failed',
        detail: (failure.stderr ?? failure.message ?? '').slice(0, 800),
      });
    }
  }

  private async apiJson<T>(
    command: string,
    args: string[],
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<T> {
    const output = await this.api(command, args, timeoutMs, signal);
    try {
      return JSON.parse(output) as T;
    } catch {
      throw new AppError('WS-5010', { reason: 'invalid_json', detail: output.slice(0, 800) });
    }
  }
}

/**
 * يعيد مسار opencode.exe إن أمكن. تفادي `.cmd` لأن execFile لا يشغّله بلا shell.
 */
export function resolveCommand(configured: string): string | null {
  if (configured && (configured.toLowerCase().endsWith('.exe') || configured.includes('\\'))) {
    return existsSync(configured) ? configured : null;
  }
  if (process.platform !== 'win32') return configured || 'opencode';
  const candidates = [
    join(process.env.APPDATA ?? '', 'npm', 'node_modules', 'opencode-ai', 'bin', 'opencode.exe'),
    join(process.env.LOCALAPPDATA ?? '', 'Programs', 'opencode', 'opencode.exe'),
  ];
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  try {
    const found = spawnSync('where.exe', ['opencode'], { encoding: 'utf8', windowsHide: true });
    for (const line of (found.stdout ?? '').split(/\r?\n/)) {
      if (!line.trim()) continue;
      if (line.toLowerCase().endsWith('.exe') && existsSync(line.trim())) return line.trim();
      if (line.toLowerCase().endsWith('.cmd')) {
        const cmdDir = dirname(line.trim());
        const exe = join(cmdDir, 'node_modules', 'opencode-ai', 'bin', 'opencode.exe');
        if (existsSync(exe)) return exe;
        try {
          const content = readFileSync(line.trim(), 'utf8');
          const match = /node_modules\\opencode-ai\\bin\\([^"%\s]+\.exe)/i.exec(content);
          if (match) {
            const resolved = join(cmdDir, 'node_modules', 'opencode-ai', 'bin', match[1] ?? '');
            if (existsSync(resolved)) return resolved;
          }
        } catch {
          // تجاهل.
        }
      }
    }
  } catch {
    // تجاهل.
  }
  return null;
}

export function buildPrompt(context: AgentRunContext): string {
  const job = context.jobFile;
  return [
    'أنت منفّذ مونتاج داخل تطبيق Workspace.',
    `اقرأ ملف المهمة: ${context.paths.jobFileRel}`,
    `نفّذ الأسلوب ${job.style.id}@${job.style.version} بالمُدخلات المذكورة حرفيًا.`,
    `كل المخرجات تُكتب داخل: ${context.paths.outputRel}`,
    `المخرجات المطلوبة: ${job.output.required.join(', ')}`,
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
        style: job.style.id,
        warnings: [],
        needs_review: [],
      },
      null,
      2,
    ),
  ].join('\n');
}
