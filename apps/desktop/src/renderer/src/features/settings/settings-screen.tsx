import type { Setting } from '@bcis/validation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@renderer/components/ui/button';
import { Alert, PageHeader } from '@renderer/components/ui/feedback';
import { Input } from '@renderer/components/ui/form';
import { DataTable, EmptyRow, Th, Td, Tr } from '@renderer/components/ui/table';
import { formatInstant } from '@renderer/lib/format';
import type { JSX } from 'react';
import { useState } from 'react';

/**
 * Settings.
 *
 * ── WHY THESE ARE ROWS AND NOT CONSTANTS ────────────────────────────────────
 * The grace period before a penalty, the suspension threshold, and the
 * reconnection fee are commercial decisions. Keeping them here means an Owner
 * changes a policy without a release, and every change is an audited UPDATE
 * rather than a code review.
 *
 * Each value is validated against the type its own row declares, so a boolean
 * setting cannot become `"maybe"` and break the phase that reads it.
 */
export function SettingsScreen(): JSX.Element {
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => window.bcis.settings.list(),
  });

  const [error, setError] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);

  const items = settings.data?.items ?? [];
  const grouped = groupByCategory(items);

  function refresh(): void {
    void queryClient.invalidateQueries({ queryKey: ['settings'] });
    void queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <PageHeader
        title="Settings"
        description="Configuration the later phases read instead of hardcoding a policy. Every change is audited."
      />

      {settings.data?.ok === false && (
        <Alert tone="danger" title="Could not load settings">
          {settings.data.error ?? 'Unknown error.'}
        </Alert>
      )}

      {error !== null && <Alert tone="danger">{error}</Alert>}

      {settings.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {[...grouped.entries()].map(([category, entries]) => (
        <section key={category} className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold capitalize text-foreground">{category}</h2>

          <DataTable>
            <thead>
              <tr>
                <Th>Setting</Th>
                <Th>Description</Th>
                <Th>Value</Th>
                <Th>Updated</Th>
                <Th align="right">Save</Th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 && (
                <EmptyRow colSpan={5}>No settings in this category.</EmptyRow>
              )}

              {entries.map((setting) => (
                <SettingRow
                  key={setting.key}
                  setting={setting}
                  saved={savedKey === setting.key}
                  onError={(message) => {
                    setError(message);
                  }}
                  onSaved={(key) => {
                    setError(null);
                    setSavedKey(key);
                    refresh();
                  }}
                />
              ))}
            </tbody>
          </DataTable>
        </section>
      ))}
    </div>
  );
}

function SettingRow({
  setting,
  saved,
  onError,
  onSaved,
}: {
  readonly setting: Setting;
  readonly saved: boolean;
  readonly onError: (message: string) => void;
  readonly onSaved: (key: string) => void;
}): JSX.Element {
  const [value, setValue] = useState(setting.value);
  const [busy, setBusy] = useState(false);

  const dirty = value !== setting.value;

  async function submit(): Promise<void> {
    setBusy(true);

    const result = await window.bcis.settings.update(setting.key, value);

    if (!result.ok) {
      onError(result.error ?? `Could not save ${setting.key}.`);
    } else {
      onSaved(setting.key);
    }

    setBusy(false);
  }

  return (
    <Tr>
      <Td>
        <div className="flex flex-col">
          <span className="font-mono text-[12px]">{setting.key}</span>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {setting.valueType}
          </span>
        </div>
      </Td>
      <Td className="text-muted-foreground">{setting.description ?? '—'}</Td>
      <Td>
        <Input
          value={value}
          aria-label={setting.key}
          onChange={(event) => {
            setValue(event.target.value);
          }}
        />
      </Td>
      <Td className="whitespace-nowrap text-xs text-muted-foreground">
        {formatInstant(setting.updatedAt)}
        {saved && !dirty && <span className="ml-2 text-success">saved</span>}
      </Td>
      <Td align="right">
        <Button
          size="sm"
          variant={dirty ? 'primary' : 'secondary'}
          disabled={busy || !dirty}
          onClick={() => {
            void submit();
          }}
        >
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </Td>
    </Tr>
  );
}

function groupByCategory(settings: readonly Setting[]): Map<string, Setting[]> {
  const grouped = new Map<string, Setting[]>();

  for (const setting of settings) {
    const existing = grouped.get(setting.category);
    if (existing === undefined) {
      grouped.set(setting.category, [setting]);
    } else {
      existing.push(setting);
    }
  }

  return grouped;
}
