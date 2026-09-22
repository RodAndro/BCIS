import { schema } from '@bcis/database';
import { asc, eq } from 'drizzle-orm';

import type { Executor } from '../../shared/database';

/**
 * Application settings queries.
 *
 * Values are stored as text with a `valueType`; the service validates a new
 * value against that type, so a boolean setting cannot become `"maybe"` and
 * break the phase that reads it.
 */

export interface SettingRow {
  readonly id: number;
  readonly key: string;
  readonly value: string;
  readonly valueType: 'string' | 'integer' | 'boolean' | 'decimal' | 'json';
  readonly category: string;
  readonly description: string | null;
  readonly updatedAt: Date;
}

export async function listSettings(db: Executor): Promise<readonly SettingRow[]> {
  const rows = await db
    .select()
    .from(schema.applicationSettings)
    .orderBy(asc(schema.applicationSettings.category), asc(schema.applicationSettings.key));

  return rows.map((row) => ({
    id: row.id,
    key: row.key,
    value: row.value,
    valueType: row.valueType as SettingRow['valueType'],
    category: row.category,
    description: row.description,
    updatedAt: row.updatedAt,
  }));
}

export async function findSettingByKey(db: Executor, key: string): Promise<SettingRow | null> {
  const rows = await db
    .select()
    .from(schema.applicationSettings)
    .where(eq(schema.applicationSettings.key, key))
    .limit(1);

  const row = rows[0];
  if (row === undefined) return null;

  return {
    id: row.id,
    key: row.key,
    value: row.value,
    valueType: row.valueType as SettingRow['valueType'],
    category: row.category,
    description: row.description,
    updatedAt: row.updatedAt,
  };
}

export async function updateSettingValue(
  db: Executor,
  key: string,
  value: string,
  updatedBy: number | null,
): Promise<void> {
  await db
    .update(schema.applicationSettings)
    .set({ value, updatedAt: new Date(), updatedBy })
    .where(eq(schema.applicationSettings.key, key));
}
