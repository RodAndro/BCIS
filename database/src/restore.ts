import { cp, mkdir, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function postgresBinary(command: string): string {
  const directory =
    process.env.POSTGRES_BIN_DIR?.trim() ||
    resolve(import.meta.dirname, '../../.runtime/pgsql/bin');
  return resolve(directory, process.platform === 'win32' ? `${command}.exe` : command);
}

interface BackupManifestFile {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

interface BackupManifest {
  readonly formatVersion: 1;
  readonly databaseArchive: string;
  readonly attachments: readonly BackupManifestFile[];
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value.length === 0) throw new Error(`${name} is required.`);
  return value;
}

async function main(): Promise<void> {
  const archive = resolve(required('BACKUP_ARCHIVE'));
  const target = required('RESTORE_DATABASE_URL');
  const preRestoreDirectory = resolve(process.env.PRE_RESTORE_BACKUP_ROOT ?? 'data/pre-restore');
  const restoredProofRoot = resolve(
    process.env.RESTORE_PROOF_STORAGE_ROOT ?? 'data/restored-proofs',
  );
  if (target === process.env.DATABASE_URL) {
    throw new Error(
      'RESTORE_DATABASE_URL must not equal DATABASE_URL. Restore into an isolated target first.',
    );
  }
  const metadata = await stat(archive);
  if (!metadata.isFile() || metadata.size === 0)
    throw new Error('BACKUP_ARCHIVE is not a non-empty file.');
  const backupDirectory = dirname(archive);
  const manifest = JSON.parse(
    await readFile(join(backupDirectory, 'manifest.json'), 'utf8'),
  ) as BackupManifest;
  if (manifest.formatVersion !== 1 || manifest.databaseArchive !== 'database.dump') {
    throw new Error('Backup manifest does not match the archive format.');
  }

  await mkdir(preRestoreDirectory, { recursive: true });
  const preRestoreArchive = resolve(
    preRestoreDirectory,
    `pre-restore-${new Date().toISOString().replaceAll(':', '-')}.dump`,
  );
  await execFileAsync(
    postgresBinary('pg_dump'),
    ['--format=custom', '--no-owner', '--no-privileges', '--file', preRestoreArchive, target],
    { windowsHide: true },
  );
  await execFileAsync(postgresBinary('pg_restore'), ['--list', archive], { windowsHide: true });
  await execFileAsync(
    postgresBinary('pg_restore'),
    ['--clean', '--if-exists', '--no-owner', '--no-privileges', '--dbname', target, archive],
    { windowsHide: true, maxBuffer: 10 * 1024 * 1024 },
  );
  await mkdir(restoredProofRoot, { recursive: true });
  for (const attachment of manifest.attachments) {
    const source = join(backupDirectory, 'proofs', attachment.path);
    const destination = join(restoredProofRoot, attachment.path);
    await mkdir(dirname(destination), { recursive: true });
    await cp(source, destination, { force: true });
    const restored = await stat(destination);
    const restoredHash = createHash('sha256')
      .update(await readFile(destination))
      .digest('hex');
    if (restored.size !== attachment.bytes || restoredHash !== attachment.sha256) {
      throw new Error(`Attachment restore verification failed for ${attachment.path}.`);
    }
  }
  process.stdout.write(
    `Restore completed into the isolated target. Pre-restore snapshot: ${preRestoreArchive}. Restored proofs: ${String(manifest.attachments.length)}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Restore failed.'}\n`);
  process.exitCode = 1;
});
