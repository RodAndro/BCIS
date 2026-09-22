import type { BackupHistory } from '@bcis/validation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@renderer/components/ui/button';
import { Alert, PageHeader, SectionCard } from '@renderer/components/ui/feedback';
import { DataTable, EmptyRow, Td, Th, Tr } from '@renderer/components/ui/table';
import type { JSX } from 'react';
import { useState } from 'react';

export function BackupScreen(): JSX.Element {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const backups = useQuery({
    queryKey: ['backups'],
    queryFn: () => window.bcis.backups.list(),
  });

  const rows = backups.data?.items ?? [];

  async function create(): Promise<void> {
    setBusy(true);
    setError(null);
    setMessage(null);
    const response = await window.bcis.backups.create();
    setBusy(false);

    if (!response.ok || response.item === null) {
      setError(response.error ?? 'The backup failed.');
      return;
    }
    setMessage(`Backup ${response.item.backupId} created and verified.`);
    void queryClient.invalidateQueries({ queryKey: ['backups'] });
  }

  async function verify(backupId: string): Promise<void> {
    setBusy(true);
    setError(null);
    setMessage(null);
    const response = await window.bcis.backups.verify(backupId);
    setBusy(false);

    if (!response.ok || response.item === null) {
      setError(response.error ?? 'Verification failed.');
      return;
    }
    setMessage(response.item.ok ? 'Verification passed.' : `Verification failed: ${response.item.notes}`);
    void queryClient.invalidateQueries({ queryKey: ['backups'] });
  }

  async function restore(backupId: string): Promise<void> {
    setBusy(true);
    setError(null);
    setMessage(null);
    const response = await window.bcis.backups.restore(backupId);
    setBusy(false);

    if (!response.ok || response.item === null) {
      setError(response.error ?? 'Restore failed.');
      return;
    }
    setMessage('The database was restored from the backup.');
    void queryClient.invalidateQueries({ queryKey: ['backups'] });
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHeader
        title="Backup & Restore"
        description="Create and verify PostgreSQL backups, and restore a verified one."
        actions={
          <Button variant="primary" disabled={busy} onClick={() => void create()}>
            Create backup
          </Button>
        }
      />

      {error !== null && (
        <Alert tone="danger" title="Operation failed">
          {error}
        </Alert>
      )}
      {message !== null && (
        <Alert tone="success" title="Done">
          {message}
        </Alert>
      )}

      <SectionCard title="Backup history">
        <DataTable className="border-0">
          <thead>
            <tr>
              <Th>Backup</Th>
              <Th>Status</Th>
              <Th>Created</Th>
              <Th>Verified</Th>
              <Th>Notes</Th>
              <Th align="right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <EmptyRow colSpan={6}>No backups have been created.</EmptyRow>}
            {rows.map((backup) => (
              <BackupRow
                key={backup.id}
                backup={backup}
                busy={busy}
                onVerify={() => void verify(backup.backupId)}
                onRestore={() => void restore(backup.backupId)}
              />
            ))}
          </tbody>
        </DataTable>
      </SectionCard>
    </div>
  );
}

function BackupRow({
  backup,
  busy,
  onVerify,
  onRestore,
}: {
  readonly backup: BackupHistory;
  readonly busy: boolean;
  readonly onVerify: () => void;
  readonly onRestore: () => void;
}): JSX.Element {
  return (
    <Tr>
      <Td className="font-mono text-[13px]">{backup.backupId}</Td>
      <Td>{backup.status}</Td>
      <Td className="whitespace-nowrap text-muted-foreground">
        {new Date(backup.createdAt).toLocaleString()}
      </Td>
      <Td className="whitespace-nowrap text-muted-foreground">
        {backup.verifiedAt === null ? '—' : new Date(backup.verifiedAt).toLocaleString()}
      </Td>
      <Td className="max-w-xs truncate text-muted-foreground">
        {backup.verificationNotes ?? '—'}
      </Td>
      <Td align="right">
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" disabled={busy} onClick={onVerify}>
            Verify
          </Button>
          <Button size="sm" variant="danger" disabled={busy} onClick={onRestore}>
            Restore
          </Button>
        </div>
      </Td>
    </Tr>
  );
}
