import { ROLE_LABELS, formatBusinessDate, toBusinessDate } from '@bcis/shared';

/**
 * Display formatting.
 *
 * ── WHY NOT `toLocaleString` ────────────────────────────────────────────────
 * The same rule as the API: a timestamp shown to a cashier must read the same
 * on all three workstations regardless of their installed locale data. The
 * business day is Asia/Manila (a fixed UTC+8), so these helpers shift by that
 * offset explicitly rather than trusting the machine's timezone.
 */

const MANILA_OFFSET_MINUTES = 8 * 60;

/** `2026-09-21T22:04:00.000Z` → `21 Sep 2026 06:04`. */
export function formatInstant(iso: string | null): string {
  if (iso === null) return '—';

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';

  const shifted = new Date(date.getTime() + MANILA_OFFSET_MINUTES * 60_000);
  const hours = String(shifted.getUTCHours()).padStart(2, '0');
  const minutes = String(shifted.getUTCMinutes()).padStart(2, '0');

  return `${formatBusinessDate(toBusinessDate(date))} ${hours}:${minutes}`;
}

/** A human label for a role code, falling back to the raw code. */
export function roleLabel(code: string): string {
  return ROLE_LABELS[code as keyof typeof ROLE_LABELS] ?? code;
}
