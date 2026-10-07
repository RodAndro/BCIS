import type { JSX } from 'react';

/**
 * Application footer.
 *
 * ── HOW IT STAYS FIXED ──────────────────────────────────────────────────────
 * It is a flex sibling of the scroll container, not a `position: fixed` bar.
 * The window is a column that never scrolls — header, scrolling content, footer
 * — so the footer occupies its own row and can never overlap the last table row
 * the way a fixed overlay would need padding to avoid. It is the same trick the
 * header already uses, which is why the two mirror each other.
 *
 * ── WHAT IS DELIBERATELY ABSENT ─────────────────────────────────────────────
 * The brand is on the left and nothing else. The connection status is not
 * repeated here: the header already carries it, and a second copy at the bottom
 * of the same window is noise dressed as information. The API address and the
 * build version do not appear either — the address is in the header and the
 * version is on System Health.
 */
export function Footer(): JSX.Element {
  return (
    <footer className="flex h-10 shrink-0 items-center gap-2 border-t border-white/15 bg-primary px-4 text-[11px] text-primary-foreground/70 sm:px-6">
      <span
        aria-hidden="true"
        className="grid size-4 shrink-0 place-items-center rounded bg-white/15 text-[9px] font-bold text-primary-foreground"
      >
        B
      </span>
      <span className="truncate">
        <span className="font-medium text-primary-foreground">BCIS Billing</span>
        <span className="ml-2 hidden sm:inline">Bukidnon Cable &amp; Internet</span>
      </span>
    </footer>
  );
}
