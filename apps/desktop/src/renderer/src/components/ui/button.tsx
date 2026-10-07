import { cn } from '@renderer/lib/utils';
import type { ButtonHTMLAttributes, JSX } from 'react';

/**
 * Button.
 *
 * A small, closed set of variants. `danger` exists for destructive actions
 * (disabling an account, resetting a password) and is the only red control in
 * the application, so red means one thing.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-accent-foreground shadow-panel hover:bg-accent-hover active:bg-accent-active',
  secondary:
    'border border-border bg-surface text-foreground hover:border-accent/40 hover:bg-muted active:bg-muted/70',
  danger: 'bg-destructive text-white hover:brightness-95 active:brightness-90',
  ghost: 'text-muted-foreground hover:bg-muted hover:text-foreground active:bg-muted/70',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-9 px-4 text-sm',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  type = 'button',
  ...rest
}: ButtonProps): JSX.Element {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-2 rounded-md font-medium transition-colors',
        'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    />
  );
}
