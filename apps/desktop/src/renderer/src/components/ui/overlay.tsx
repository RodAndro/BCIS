import { Button } from '@renderer/components/ui/button';
import type { JSX, ReactNode } from 'react';
import { useEffect } from 'react';

/**
 * Modal.
 *
 * Escape closes, the backdrop closes, and the panel is marked as a dialog for
 * assistive technology. Deliberately not a route: these are short-lived
 * confirmations and small forms, and a modal that survives a reload would be a
 * half-finished record presented as a saved one.
 */

export interface ModalProps {
  readonly open: boolean;
  readonly title: string;
  /**
   * `| undefined` is required, not decorative: `exactOptionalPropertyTypes` is
   * on, so a caller passing `description={maybeUndefined}` would otherwise be
   * rejected even though omitting the prop entirely is allowed.
   */
  readonly description?: string | undefined;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  readonly width?: 'sm' | 'md' | 'lg';
}

const WIDTHS = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl' } as const;

export function Modal({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  width = 'md',
}: ModalProps): JSX.Element | null {
  useEffect(() => {
    if (!open) return undefined;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`mt-10 w-full ${WIDTHS[width]} rounded-lg border border-border bg-surface shadow-xl`}
      >
        <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
            {description !== undefined && (
              <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
            )}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
            Close
          </Button>
        </header>

        <div className="px-5 py-4">{children}</div>

        {footer !== undefined && (
          <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
