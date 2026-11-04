import { z } from 'zod';

/**
 * عقد ملف الوظيفة job.json — يُكتب بواسطة المحرّك ويقرأه الوكيل.
 * الإصدار 1. أي تغيير جوهري يرفع schema.
 */
export const jobFileSchema = z.object({
  schema: z.literal(1),
  job_id: z.string().min(1),
  event: z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    kind: z.string().min(1),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  inputs: z.record(z.string(), z.unknown()),
  style: z.object({
    id: z.string().min(1),
    version: z.string().min(1),
    params: z.record(z.string(), z.unknown()),
  }),
  output: z.object({
    dir: z.string().min(1),
    required: z.array(z.string().min(1)).min(1),
  }),
  limits: z.object({
    max_minutes: z.number().int().min(1).max(1440),
  }),
});

export type JobFile = z.infer<typeof jobFileSchema>;

export const jobOutputSchema = z.object({
  path: z.string().min(1),
  duration: z.number().positive().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  fps: z.number().positive().optional(),
  bytes: z.number().int().nonnegative().optional(),
});

/** عقد result.json — لا تُقبل وظيفة ناجحة بدونه. */
export const resultFileSchema = z.object({
  ok: z.boolean(),
  outputs: z.array(jobOutputSchema),
  loudness: z
    .object({
      lufs: z.number(),
      true_peak: z.number(),
    })
    .optional(),
  style: z.string().optional(),
  warnings: z.array(z.string()).optional(),
  needs_review: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

export type ResultFile = z.infer<typeof resultFileSchema>;
export type JobOutputFile = z.infer<typeof jobOutputSchema>;

export function parseResultFile(value: unknown): ResultFile {
  const parsed = resultFileSchema.safeParse(value);
  if (!parsed.success) {
    const error = new Error('invalid result.json') as Error & { zod?: unknown };
    error.zod = parsed.error.issues;
    throw error;
  }
  if (!parsed.data.ok) {
    throw new Error('result.json reports ok=false');
  }
  return parsed.data;
}
