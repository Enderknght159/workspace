import { describe, expect, it } from 'vitest';
import type { CommandRunner, CommandResult } from './doctor-service.js';
import { DoctorService } from './doctor-service.js';
import { createLogger } from '../util/logger.js';
import { EventBus } from '../util/event-bus.js';
import { OfficePaths } from '../office/paths.js';
import { MachineProfileStore } from './machine-profile.js';
import { makeTempDir } from '../testing/harness.js';

class FakeRunner implements CommandRunner {
  constructor(private readonly responses: Record<string, CommandResult>) {}

  async run(command: string, args: string[]): Promise<CommandResult> {
    const key = `${command} ${args.join(' ')}`;
    return (
      this.responses[key] ?? {
        ok: false,
        stdout: '',
        stderr: 'not found',
        code: 1,
      }
    );
  }
}

function ok(stdout = ''): CommandResult {
  return { ok: true, stdout, stderr: '', code: 0 };
}

function makeDoctor(responses: Record<string, CommandResult>) {
  const dir = makeTempDir('doctor-test-');
  const paths = new OfficePaths(dir);
  paths.ensureDirs();
  const profile = new MachineProfileStore(paths);
  const service = new DoctorService({
    profile,
    bus: new EventBus(),
    logger: createLogger({ level: 'error' }),
    runner: new FakeRunner(responses),
  });
  return { service, profile };
}

describe('doctor', () => {
  it('reports ok when ffmpeg/python/opencode are present', async () => {
    const { service, profile } = makeDoctor({
      'ffmpeg -version': ok('ffmpeg version 7.1.1-full_build Copyright'),
      'ffmpeg -hide_banner -filters': ok(' xfade  subtitles  drawtext  overlay  cropdetect '),
      'python --version': ok('Python 3.12.4'),
      'nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader': ok(
        'NVIDIA RTX 2050, 4096 MiB, 610.62',
      ),
      'opencode --version': ok('0.15.2'),
    });
    const report = await service.run();
    expect(report.ok).toBe(true);
    expect(report.tools.find((tool) => tool.id === 'ffmpeg')?.status).toBe('ok');
    expect(report.tools.find((tool) => tool.id === 'python')?.status).toBe('ok');
    expect(report.tools.find((tool) => tool.id === 'gpu')?.status).toBe('ok');
    expect(profile.doctor()?.checkedAt).toBe(report.checkedAt);
  });

  it('fails when ffmpeg filters are missing', async () => {
    const { service } = makeDoctor({
      'ffmpeg -version': ok('ffmpeg version 7.1.1'),
      'ffmpeg -hide_banner -filters': ok(' xfade '),
      'python --version': ok('Python 3.12.4'),
    });
    const report = await service.run();
    expect(report.ok).toBe(false);
    const ffmpeg = report.tools.find((tool) => tool.id === 'ffmpeg');
    expect(ffmpeg?.status).toBe('fail');
    expect(ffmpeg?.detail).toContain('subtitles');
  });

  it('fails when python is absent', async () => {
    const { service } = makeDoctor({
      'ffmpeg -version': ok('ffmpeg version 7.1.1'),
      'ffmpeg -hide_banner -filters': ok(' xfade subtitles drawtext overlay cropdetect '),
    });
    const report = await service.run();
    expect(report.ok).toBe(false);
    expect(report.tools.find((tool) => tool.id === 'python')?.status).toBe('fail');
  });
});
