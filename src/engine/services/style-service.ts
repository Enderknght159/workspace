import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { AppError } from '../../shared/errors.js';
import type { ChecklistItem, StyleInfo } from '../../shared/models.js';
import { stylePackageSchema, type StylePackage } from '../../shared/style.js';
import type { Database } from '../db/database.js';
import type { Logger } from '../util/logger.js';
import type { OfficePaths } from '../office/paths.js';

const SAMPLE_STYLE = {
  id: 'sample-reel',
  name: 'ريل تجريبي',
  skill: 'mock',
  version: '1.0.0',
  description:
    'أسلوب تجريبي يثبت سير العمل من الطابور إلى المراجعة. استبدله بحزمة أسلوب حقيقية في مجلد styles.',
  inputs: ['SOURCE_VIDEO', 'OUTPUT_DIR'],
  outputs: ['final.mp4', 'result.json'],
  est_minutes: 1,
  gpu: false,
  checklist: [
    { id: 'watch', label: 'شوهد الملف كاملًا', required: true },
    { id: 'audio', label: 'الصوت واضح ومستوى -14 LUFS', required: true },
    { id: 'captions', label: 'الكابشنز مطابقة للمسموع', required: true },
  ],
};

const SAMPLE_PROMPT = `# ريل تجريبي

هذه حزمة أسلوب تجريبية. الوكيل التجريبي لا ينتج فيديو حقيقيًا.
الهدف منها اختبار: قراءة job.json، كتابة المخرجات، وكتابة result.json صالح.
استبدل هذا المجلد بحزمة أسلوب حقيقية (style.json + prompt.md) عند الجاهزية.
`;

const SAMPLE_STYLE_JSON = `${JSON.stringify(SAMPLE_STYLE, null, 2)}\n`;

interface StyleRow {
  id: string;
  name: string;
  skill_id: string;
  version: string;
  hash: string;
  params_schema_json: string;
  outputs_json: string;
  checklist_json: string;
  requirements_json: string;
  description: string;
  est_minutes: number;
  gpu: number;
  preview_path: string | null;
  enabled: number;
  installed_at: string;
}

export class StyleService {
  constructor(
    private readonly db: Database,
    private readonly paths: OfficePaths,
    private readonly logger: Logger,
  ) {}

  ensureSample(): void {
    mkdirSync(this.paths.stylesDir, { recursive: true });
    const entries = readdirSync(this.paths.stylesDir, { withFileTypes: true }).filter((entry) =>
      entry.isDirectory(),
    );
    const hasStyle = entries.some((entry) =>
      existsSync(join(this.paths.stylesDir, entry.name, 'style.json')),
    );
    if (hasStyle) return;
    const dir = join(this.paths.stylesDir, 'sample-reel');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'style.json'), SAMPLE_STYLE_JSON, 'utf8');
    writeFileSync(join(dir, 'prompt.md'), SAMPLE_PROMPT, 'utf8');
    this.logger.info('styles.sample_created', { dir });
  }

  reload(): StyleInfo[] {
    mkdirSync(this.paths.stylesDir, { recursive: true });
    const seen = new Set<string>();
    for (const entry of readdirSync(this.paths.stylesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = join(this.paths.stylesDir, entry.name);
      const file = join(dir, 'style.json');
      if (!existsSync(file)) continue;
      try {
        const parsed = stylePackageSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
        this.upsert(parsed, dir);
        seen.add(parsed.id);
      } catch (error) {
        this.logger.warn('styles.invalid', { dir, error: String(error) });
      }
    }
    for (const row of this.db.all<{ id: string }>('SELECT id FROM styles')) {
      if (!seen.has(row.id)) {
        this.db.run('UPDATE styles SET enabled = 0 WHERE id = ?', row.id);
      }
    }
    return this.list();
  }

  list(includeDisabled = true): StyleInfo[] {
    const rows = includeDisabled
      ? this.db.all<StyleRow>('SELECT * FROM styles ORDER BY name ASC')
      : this.db.all<StyleRow>('SELECT * FROM styles WHERE enabled = 1 ORDER BY name ASC');
    return rows.map(mapStyleRow);
  }

  get(id: string): StyleInfo {
    const row = this.db.get<StyleRow>('SELECT * FROM styles WHERE id = ?', id);
    if (!row) throw new AppError('WS-5008', { styleId: id });
    return mapStyleRow(row);
  }

  checklist(id: string): ChecklistItem[] {
    return this.get(id).checklist;
  }

  private upsert(style: StylePackage, dir: string): void {
    const hash = hashDirectory(dir);
    const checklist = style.checklist ?? [];
    const requirements = (style.requires ?? []).map((requirement) =>
      requirement.min ? `${requirement.id} >= ${requirement.min}` : requirement.id,
    );
    this.db.run(
      `INSERT INTO styles
        (id, name, skill_id, version, hash, params_schema_json, outputs_json, checklist_json, requirements_json,
         description, est_minutes, gpu, preview_path, enabled, installed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, skill_id = excluded.skill_id, version = excluded.version,
         hash = excluded.hash, params_schema_json = excluded.params_schema_json,
         outputs_json = excluded.outputs_json,
         checklist_json = excluded.checklist_json, requirements_json = excluded.requirements_json,
         description = excluded.description, est_minutes = excluded.est_minutes,
         gpu = excluded.gpu, preview_path = excluded.preview_path, enabled = 1`,
      style.id,
      style.name,
      style.skill,
      style.version,
      hash,
      JSON.stringify(style.params ?? {}),
      JSON.stringify(style.outputs ?? []),
      JSON.stringify(checklist),
      JSON.stringify(requirements),
      style.description ?? '',
      style.est_minutes ?? 60,
      style.gpu ? 1 : 0,
      null,
      new Date().toISOString(),
    );
  }
}

function mapStyleRow(row: StyleRow): StyleInfo {
  return {
    id: row.id,
    name: row.name,
    skillId: row.skill_id,
    version: row.version,
    hash: row.hash,
    description: row.description,
    estMinutes: row.est_minutes,
    gpu: row.gpu === 1,
    enabled: row.enabled === 1,
    checklist: safeJson<ChecklistItem[]>(row.checklist_json, []),
    outputs: safeJson<string[]>(row.outputs_json, []),
    previewPath: row.preview_path,
    requirements: safeJson<string[]>(row.requirements_json, []),
  };
}

function safeJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function hashDirectory(dir: string): string {
  const hash = createHash('sha256');
  const files: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name !== 'preview.jpg') files.push(full);
    }
  };
  walk(dir);
  files.sort();
  for (const file of files) {
    hash.update(relative(dir, file).split('\\').join('/'));
    hash.update(statSync(file).size.toString());
    hash.update(readFileSync(file));
  }
  return hash.digest('hex');
}
