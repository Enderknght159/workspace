import { execFile } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { promisify } from 'node:util';
import type { DoctorReport, ToolCheck, ToolStatus } from '../../shared/models.js';
import { APP_VERSION } from '../../shared/constants.js';
import type { MachineProfileStore } from './machine-profile.js';
import type { Logger } from '../util/logger.js';
import type { EventBus } from '../util/event-bus.js';
import { machineId } from '../util/misc.js';

export interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number;
}

export interface CommandRunner {
  run(command: string, args: string[], options?: { timeoutMs?: number }): Promise<CommandResult>;
}

const execFileAsync = promisify(execFile);

export class DefaultCommandRunner implements CommandRunner {
  async run(
    command: string,
    args: string[],
    options: { timeoutMs?: number } = {},
  ): Promise<CommandResult> {
    try {
      const { stdout, stderr } = await execFileAsync(command, args, {
        timeout: options.timeoutMs ?? 8000,
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
        encoding: 'utf8',
      });
      return { ok: true, stdout, stderr, code: 0 };
    } catch (error) {
      const failure = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number };
      return {
        ok: false,
        stdout: failure.stdout ?? '',
        stderr: failure.stderr ?? '',
        code: typeof failure.code === 'number' ? failure.code : 1,
      };
    }
  }
}

export interface DoctorServiceDeps {
  profile: MachineProfileStore;
  bus: EventBus;
  logger: Logger;
  runner?: CommandRunner;
}

const REQUIRED_FILTERS = ['xfade', 'subtitles', 'drawtext', 'overlay', 'cropdetect'];

export class DoctorService {
  private readonly runner: CommandRunner;

  constructor(private readonly deps: DoctorServiceDeps) {
    this.runner = deps.runner ?? new DefaultCommandRunner();
  }

  last(): DoctorReport | null {
    return this.deps.profile.doctor();
  }

  async run(options: { deep?: boolean } = {}): Promise<DoctorReport> {
    const tools: ToolCheck[] = [];

    const ffmpeg = await this.checkFfmpeg();
    tools.push(ffmpeg);

    const python = await this.checkPython();
    tools.push(python);

    tools.push(await this.checkNode());
    tools.push(await this.checkGpu());
    tools.push(await this.checkOpenCode());

    if (options.deep) {
      tools.push(...(await this.checkDeepTools(python.status === 'ok')));
    }

    tools.push(this.checkPremiere());

    const ok = tools.every((tool) => tool.status !== 'fail');
    const report: DoctorReport = {
      ok,
      checkedAt: new Date().toISOString(),
      machineId: machineId(),
      platform: process.platform,
      arch: process.arch,
      cpus: cpus().length,
      totalMemoryGb: Math.round((totalmem() / 1024 ** 3) * 10) / 10,
      tools,
    };
    this.deps.profile.setDoctor(report);
    this.deps.bus.publish({ type: 'doctor.updated', ok });
    this.deps.logger.info('doctor.checked', { ok, failed: tools.filter((tool) => tool.status === 'fail').map((tool) => tool.id) });
    return report;
  }

  private async checkFfmpeg(): Promise<ToolCheck> {
    const version = await this.runner.run('ffmpeg', ['-version'], { timeoutMs: 8000 });
    if (!version.ok) {
      return {
        id: 'ffmpeg',
        label: 'FFmpeg',
        status: 'fail',
        version: null,
        detail: 'غير مثبت أو غير موجود في PATH',
        action: 'ثبّت FFmpeg 6.1 أو أحدث وأضفه إلى PATH ثم أعد الفحص.',
      };
    }
    const match = /ffmpeg version (\S+)/i.exec(version.stdout);
    const versionText = match?.[1] ?? 'unknown';
    const filters = await this.runner.run('ffmpeg', ['-hide_banner', '-filters'], { timeoutMs: 12_000 });
    const missing = REQUIRED_FILTERS.filter((filter) => !new RegExp(`\\b${filter}\\b`).test(filters.stdout));
    const major = Number.parseInt(versionText.split('.')[0] ?? '0', 10);
    if (missing.length > 0) {
      return {
        id: 'ffmpeg',
        label: 'FFmpeg',
        status: 'fail',
        version: versionText,
        detail: `مرشحات ناقصة: ${missing.join(', ')}`,
        action: 'ثبّت نسخة FFmpeg كاملة (full build) من الموقع الرسمي.',
      };
    }
    if (!Number.isNaN(major) && major < 6) {
      return {
        id: 'ffmpeg',
        label: 'FFmpeg',
        status: 'warn',
        version: versionText,
        detail: 'الإصدار أقدم من الموصى به (6.1).',
        action: 'حدّث FFmpeg إلى 6.1 أو أحدث.',
      };
    }
    return {
      id: 'ffmpeg',
      label: 'FFmpeg',
      status: 'ok',
      version: versionText,
      detail: 'كل المرشحات المطلوبة موجودة.',
      action: null,
    };
  }

  private async checkPython(): Promise<ToolCheck> {
    const attempts: Array<{ command: string; args: string[] }> = [
      { command: 'python', args: ['--version'] },
      { command: 'py', args: ['-3', '--version'] },
    ];
    for (const attempt of attempts) {
      const result = await this.runner.run(attempt.command, attempt.args, { timeoutMs: 8000 });
      if (!result.ok) continue;
      const output = `${result.stdout} ${result.stderr}`.trim();
      const match = /Python (\d+\.\d+\.\d+)/i.exec(output);
      const version = match?.[1] ?? output;
      const major = Number.parseInt(version.split('.')[0] ?? '0', 10);
      const minor = Number.parseInt(version.split('.')[1] ?? '0', 10);
      if (major > 3 || (major === 3 && minor >= 10)) {
        return {
          id: 'python',
          label: 'Python',
          status: 'ok',
          version,
          detail: null,
          action: null,
        };
      }
      return {
        id: 'python',
        label: 'Python',
        status: 'fail',
        version,
        detail: 'الإصدار أقدم من 3.10.',
        action: 'ثبّت Python 3.10 أو أحدث.',
      };
    }
    return {
      id: 'python',
      label: 'Python',
      status: 'fail',
      version: null,
      detail: 'غير مثبت أو غير موجود في PATH',
      action: 'ثبّت Python 3.10 أو أحدث وفعّل خيار Add to PATH.',
    };
  }

  private async checkNode(): Promise<ToolCheck> {
    return {
      id: 'node',
      label: 'Node.js (المحرّك)',
      status: 'ok',
      version: process.version,
      detail: null,
      action: null,
    };
  }

  private async checkGpu(): Promise<ToolCheck> {
    const result = await this.runner.run(
      'nvidia-smi',
      ['--query-gpu=name,memory.total,driver_version', '--format=csv,noheader'],
      { timeoutMs: 10_000 },
    );
    if (!result.ok) {
      return {
        id: 'gpu',
        label: 'بطاقة NVIDIA',
        status: 'warn',
        version: null,
        detail: 'لم يُعثر على nvidia-smi؛ قد تكون البطاقة غير NVIDIA أو التعريف غير مثبت.',
        action: 'شخّص التعريف يدويًا من موقع NVIDIA (لا يُثبَّت تلقائيًا).',
      };
    }
    const line = result.stdout.trim().split(/\r?\n/)[0] ?? '';
    const [name, memory, driver] = line.split(',').map((part) => part.trim());
    return {
      id: 'gpu',
      label: 'بطاقة NVIDIA',
      status: 'ok',
      version: driver ?? null,
      detail: `${name ?? 'GPU'} — ${memory ?? '?'} — Driver ${driver ?? '?'}`,
      action: null,
    };
  }

  private async checkOpenCode(): Promise<ToolCheck> {
    const result = await this.runner.run('opencode', ['--version'], { timeoutMs: 8000 });
    if (!result.ok) {
      return {
        id: 'opencode',
        label: 'OpenCode',
        status: 'warn',
        version: null,
        detail: 'غير مثبت أو غير موجود في PATH.',
        action: 'ثبّت OpenCode وسجّل الدخول لمزوّد النماذج، أو استخدم الوضع التجريبي.',
      };
    }
    return {
      id: 'opencode',
      label: 'OpenCode',
      status: 'ok',
      version: result.stdout.trim() || 'unknown',
      detail: null,
      action: null,
    };
  }

  private async checkDeepTools(pythonAvailable: boolean): Promise<ToolCheck[]> {
    const checks: ToolCheck[] = [];
    if (pythonAvailable) {
      const torch = await this.runner.run(
        'python',
        ['-c', 'import torch;print(torch.__version__, torch.cuda.is_available())'],
        { timeoutMs: 60_000 },
      );
      if (torch.ok) {
        const [version, cuda] = torch.stdout.trim().split(/\s+/);
        checks.push({
          id: 'torch',
          label: 'PyTorch / CUDA',
          status: cuda === 'True' ? 'ok' : 'warn',
          version: version ?? null,
          detail: cuda === 'True' ? 'CUDA متاح.' : 'CUDA غير متاح؛ سيُستخدم CPU أو int8.',
          action: cuda === 'True' ? null : 'راجع تعريف البطاقة وإصدار PyTorch.',
        });
      } else {
        checks.push({
          id: 'torch',
          label: 'PyTorch / CUDA',
          status: 'warn',
          version: null,
          detail: 'PyTorch غير مثبت أو فشل الاستيراد.',
          action: 'ثبّت PyTorch المناسب لبطاقتك عند الحاجة للتفريغ المتسارع.',
        });
      }
      const whisper = await this.runner.run(
        'python',
        ['-c', 'import whisper;print(whisper.__version__)'],
        { timeoutMs: 30_000 },
      );
      checks.push({
        id: 'whisper',
        label: 'Whisper',
        status: whisper.ok ? 'ok' : 'warn',
        version: whisper.ok ? whisper.stdout.trim() : null,
        detail: whisper.ok ? null : 'غير مثبت أو فشل الاستيراد.',
        action: whisper.ok ? null : 'ثبّت openai-whisper عند الحاجة للتفريغ.',
      });
    }
    const remotion = await this.runner.run('npx', ['remotion', 'versions'], { timeoutMs: 30_000 });
    checks.push({
      id: 'remotion',
      label: 'Remotion',
      status: remotion.ok ? 'ok' : 'warn',
      version: remotion.ok ? remotion.stdout.trim().split(/\r?\n/)[0] ?? null : null,
      detail: remotion.ok ? null : 'npx remotion غير متاح.',
      action: remotion.ok ? null : 'ثبّت Remotion 4.x في المشروع الذي تستخدمه الأساليب.',
    });
    return checks;
  }

  private checkPremiere(): ToolCheck {
    if (process.platform !== 'win32') {
      return {
        id: 'premiere',
        label: 'Adobe Premiere',
        status: 'warn',
        version: null,
        detail: 'غير مدعوم على هذا النظام.',
        action: null,
      };
    }
    const roots = ['C:/Program Files/Adobe'];
    for (const root of roots) {
      if (!existsSync(root)) continue;
      try {
        const dir = readdirSync(root).find((entry) => entry.startsWith('Adobe Premiere Pro'));
        if (dir) {
          return {
            id: 'premiere',
            label: 'Adobe Premiere',
            status: 'ok',
            version: dir.replace('Adobe Premiere Pro ', ''),
            detail: null,
            action: null,
          };
        }
      } catch {
        // تجاهل أخطاء القراءة.
      }
    }
    return {
      id: 'premiere',
      label: 'Adobe Premiere',
      status: 'warn',
      version: null,
      detail: 'لم يُعثر عليه في المسار الافتراضي.',
      action: 'ثبّت Premiere أو حدّد مساره عند الحاجة للوضع الهجين.',
    };
  }
}

export function reportSummary(report: DoctorReport): string {
  const counts: Record<ToolStatus, number> = { ok: 0, warn: 0, fail: 0, unknown: 0 };
  for (const tool of report.tools) counts[tool.status] += 1;
  return `ok=${counts.ok} warn=${counts.warn} fail=${counts.fail}`;
}

export { APP_VERSION };
