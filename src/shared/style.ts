import { z } from 'zod';
import { checklistItemSchema } from './schemas.js';

/** حزمة الأسلوب: بيانات في مجلد styles، لا منطق في الكود. */
export const stylePackageSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().min(1).max(120),
  skill: z.string().min(1).max(120),
  version: z.string().min(1).max(40),
  description: z.string().max(500).optional(),
  requires: z
    .array(
      z.object({
        id: z.string().min(1),
        min: z.string().optional(),
        filters: z.array(z.string()).optional(),
        model: z.string().optional(),
      }),
    )
    .optional(),
  inputs: z.array(z.string()).optional(),
  outputs: z.array(z.string()).optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  est_minutes: z.number().int().min(1).max(10_000).optional(),
  gpu: z.boolean().optional(),
  checklist: z.array(checklistItemSchema).optional(),
  preview: z.string().optional(),
});

export type StylePackage = z.infer<typeof stylePackageSchema>;

export const recipeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  event_kind: z.string().min(1),
  jobs: z.array(
    z.object({
      kind: z.string().min(1),
      style: z.string().optional(),
      count: z.number().int().min(1).max(50).optional(),
    }),
  ),
  description: z.string().optional(),
});

export type Recipe = z.infer<typeof recipeSchema>;
