import { z } from 'zod';

export const backupIdParamSchema = z.object({ backupId: z.string().uuid() });

export const backupHistorySchema = z.object({
  id: z.number().int().positive(),
  backupId: z.string().uuid(),
  backupPath: z.string(),
  attachmentManifestPath: z.string(),
  status: z.enum(['STARTED', 'VERIFIED', 'FAILED', 'RESTORED']),
  byteSize: z.number().int().nonnegative(),
  sha256: z.string().length(64).nullable(),
  createdBy: z.number().int().positive().nullable(),
  createdAt: z.string(),
  verifiedAt: z.string().nullable(),
  verificationNotes: z.string().nullable(),
});
export type BackupHistory = z.infer<typeof backupHistorySchema>;
