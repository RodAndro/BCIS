import { schema } from '@bcis/database';
import { desc, eq } from 'drizzle-orm';

import type { Executor, Tx } from '../../shared/database';

export async function insertBackup(
  tx: Tx,
  values: typeof schema.backupHistory.$inferInsert,
): Promise<number> {
  const rows = await tx
    .insert(schema.backupHistory)
    .values(values)
    .returning({ id: schema.backupHistory.id });
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('Inserting backup history returned no id.');
  return id;
}

export async function updateBackup(
  tx: Tx,
  backupId: string,
  values: Partial<typeof schema.backupHistory.$inferInsert>,
): Promise<void> {
  await tx
    .update(schema.backupHistory)
    .set(values)
    .where(eq(schema.backupHistory.backupId, backupId));
}

export async function findBackup(db: Executor, backupId: string) {
  const rows = await db
    .select()
    .from(schema.backupHistory)
    .where(eq(schema.backupHistory.backupId, backupId))
    .limit(1);
  return rows[0] ?? null;
}

export async function listBackups(db: Executor) {
  return db
    .select()
    .from(schema.backupHistory)
    .orderBy(desc(schema.backupHistory.createdAt))
    .limit(100);
}
