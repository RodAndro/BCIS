import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { cp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { NotFoundError } from '@bcis/shared';
import { env } from '../../config/env';
import type { Db } from '../../shared/database';
import type { ActorContext } from '../../shared/request-context';
import { AUDIT_ACTIONS, AUDIT_ENTITIES } from '../audit/audit.actions';
import { writeAudit } from '../audit/audit.service';
import * as repository from './backup.repository';

const execFileAsync = promisify(execFile);

interface BackupManifestFile {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

interface BackupManifest {
  readonly formatVersion: 1;
  readonly backupId: string;
  readonly createdAt: string;
  readonly databaseArchive: string;
  readonly attachments: readonly BackupManifestFile[];
  readonly configuration: readonly string[];
}

function sha256File(path: string): Promise<string> {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', (chunk: string | Buffer) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolveHash(hash.digest('hex')));
  });
}

async function filesUnder(root: string): Promise<BackupManifestFile[]> {
  const files: BackupManifestFile[] = [];
  async function visit(current: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await visit(path);
      if (entry.isFile()) {
        const file = await stat(path);
        files.push({
          path: relative(root, path).replaceAll('\\', '/'),
          bytes: file.size,
          sha256: await sha256File(path),
        });
      }
    }
  }
  await visit(root);
  return files;
}

async function run(command: string, args: readonly string[]): Promise<void> {
  const executable = resolve(
    env.POSTGRES_BIN_DIR,
    process.platform === 'win32' ? `${command}.exe` : command,
  );
  await execFileAsync(executable, [...args], { windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
}

function backupRoot(): string {
  return resolve(env.BACKUP_ROOT);
}

export async function verifyBackupFiles(
  backupDirectory: string,
): Promise<{ ok: boolean; notes: string }> {
  const manifestPath = join(backupDirectory, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as BackupManifest;
  const archive = join(backupDirectory, manifest.databaseArchive);
  await run('pg_restore', ['--list', archive]);
  for (const file of manifest.attachments) {
    const path = join(backupDirectory, 'proofs', file.path);
    const metadata = await stat(path);
    if (metadata.size !== file.bytes || (await sha256File(path)) !== file.sha256) {
      return { ok: false, notes: `Attachment verification failed for ${file.path}.` };
    }
  }
  return {
    ok: true,
    notes: `Verified PostgreSQL archive and ${String(manifest.attachments.length)} attachment(s).`,
  };
}

export async function createBackup(
  db: Db,
  actor: ActorContext,
): Promise<{ backupId: string; status: 'VERIFIED'; path: string }> {
  const backupId = randomUUID();
  const directory = join(backupRoot(), backupId);
  const archiveName = 'database.dump';
  const archivePath = join(directory, archiveName);
  const proofRoot = resolve(env.PROOF_STORAGE_ROOT);
  await mkdir(directory, { recursive: true });
  await mkdir(proofRoot, { recursive: true });
  await mkdir(join(directory, 'proofs'), { recursive: true });

  await db.transaction(async (tx) => {
    await repository.insertBackup(tx, {
      backupId,
      backupPath: archivePath,
      attachmentManifestPath: join(directory, 'manifest.json'),
      status: 'STARTED',
      createdBy: actor.userId,
    });
  });

  try {
    await run('pg_dump', [
      '--format=custom',
      '--no-owner',
      '--no-privileges',
      '--file',
      archivePath,
      env.DATABASE_URL,
    ]);
    await cp(proofRoot, join(directory, 'proofs'), { recursive: true, force: true });
    const attachments = await filesUnder(join(directory, 'proofs'));
    const manifest: BackupManifest = {
      formatVersion: 1,
      backupId,
      createdAt: new Date().toISOString(),
      databaseArchive: archiveName,
      attachments,
      configuration: ['NODE_ENV', 'API_HOST', 'API_PORT', 'BACKUP_ROOT', 'PROOF_STORAGE_ROOT'],
    };
    await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
    const verification = await verifyBackupFiles(directory);
    if (!verification.ok) throw new Error(verification.notes);
    const metadata = await stat(archivePath);
    const sha256 = await sha256File(archivePath);
    await db.transaction(async (tx) => {
      await repository.updateBackup(tx, backupId, {
        status: 'VERIFIED',
        byteSize: metadata.size,
        sha256,
        verifiedAt: new Date(),
        verificationNotes: verification.notes,
      });
      await writeAudit(tx, {
        action: AUDIT_ACTIONS.BACKUP_CREATED,
        entityType: AUDIT_ENTITIES.BACKUP,
        entityId: backupId,
        actorUserId: actor.userId,
        sessionId: actor.sessionId,
        ip: actor.ip,
        newValues: { status: 'VERIFIED', byteSize: metadata.size, sha256 },
      });
    });
    return { backupId, status: 'VERIFIED' as const, path: directory };
  } catch (error) {
    await db.transaction(async (tx) => {
      await repository.updateBackup(tx, backupId, {
        status: 'FAILED',
        verificationNotes: error instanceof Error ? error.message : 'Backup failed.',
      });
    });
    throw error;
  }
}

export async function verifyBackup(
  db: Db,
  backupId: string,
  actor: ActorContext,
): Promise<{ backupId: string; ok: boolean; notes: string }> {
  const backup = await repository.findBackup(db, backupId);
  if (backup === null) throw new NotFoundError('That backup does not exist.');
  const result = await verifyBackupFiles(resolve(backup.backupPath, '..'));
  await db.transaction(async (tx) => {
    await repository.updateBackup(tx, backupId, {
      status: result.ok ? 'VERIFIED' : 'FAILED',
      verifiedAt: new Date(),
      verificationNotes: result.notes,
    });
    await writeAudit(tx, {
      action: AUDIT_ACTIONS.BACKUP_VERIFIED,
      entityType: AUDIT_ENTITIES.BACKUP,
      entityId: backupId,
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      ip: actor.ip,
      newValues: { ok: result.ok, notes: result.notes },
    });
  });
  return { backupId, ...result };
}

/**
 * Restore a verified backup.
 *
 * ── WHO MAY CALL THIS ───────────────────────────────────────────────────────
 * Decision A15: Owner/Super Admin only. The route declares `backup.restore`,
 * which no seeded role holds — so only an OWNER, who is granted every
 * permission, can reach this. The database is dropped and rebuilt from the
 * archive, and a pre-restore verification is performed first.
 */
export async function restoreBackup(
  db: Db,
  backupId: string,
  actor: ActorContext,
): Promise<{ backupId: string; status: 'RESTORED' }> {
  const backup = await repository.findBackup(db, backupId);
  if (backup === null) throw new NotFoundError('That backup does not exist.');

  const directory = resolve(backup.backupPath, '..');
  const verification = await verifyBackupFiles(directory);
  if (!verification.ok) {
    throw new Error(`The backup cannot be restored: ${verification.notes}`);
  }

  const manifestPath = join(directory, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as BackupManifest;
  const archive = join(directory, manifest.databaseArchive);

  await run('pg_restore', [
    '--clean',
    '--if-exists',
    '--no-owner',
    '--no-privileges',
    '--dbname',
    env.DATABASE_URL,
    archive,
  ]);

  await db.transaction(async (tx) => {
    await repository.updateBackup(tx, backupId, { status: 'RESTORED', verifiedAt: new Date() });
    await writeAudit(tx, {
      action: AUDIT_ACTIONS.BACKUP_RESTORED,
      entityType: AUDIT_ENTITIES.BACKUP,
      entityId: backupId,
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      ip: actor.ip,
      newValues: { status: 'RESTORED' },
    });
  });

  return { backupId, status: 'RESTORED' };
}
