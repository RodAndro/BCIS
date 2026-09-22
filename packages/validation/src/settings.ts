import { z } from 'zod';

/**
 * Application settings contracts.
 *
 * Values travel as strings with a `valueType` describing how to read them, so
 * one table serves every setting without three nullable columns.
 */

export const settingValueTypeSchema = z.enum(['string', 'integer', 'boolean', 'decimal', 'json']);

export const settingSchema = z.object({
  key: z.string(),
  value: z.string(),
  valueType: settingValueTypeSchema,
  category: z.string(),
  description: z.string().nullable(),
  updatedAt: z.string(),
});

export type Setting = z.infer<typeof settingSchema>;

/**
 * Update a setting's value.
 *
 * The value is validated against the type the row already declares, so a
 * `boolean` setting cannot silently become `"maybe"` and break the phase that
 * reads it.
 */
export const updateSettingSchema = z.object({
  value: z.string().trim().min(1, 'Enter a value.').max(500),
});

export type UpdateSettingInput = z.infer<typeof updateSettingSchema>;

/** Validate a raw value string against a declared type. */
export function isValidSettingValue(
  value: string,
  valueType: z.infer<typeof settingValueTypeSchema>,
): boolean {
  switch (valueType) {
    case 'integer':
      return /^-?\d+$/.test(value);
    case 'decimal':
      return /^-?\d+(\.\d+)?$/.test(value);
    case 'boolean':
      return value === 'true' || value === 'false';
    case 'json':
      try {
        JSON.parse(value);
        return true;
      } catch {
        return false;
      }
    case 'string':
      return true;
  }
}
