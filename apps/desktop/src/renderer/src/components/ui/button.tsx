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
  primary: 'bg-accent text-accent-foreground hover:brightness-110',
  secondary: 'border border-border bg-surface text-foreground hover:bg-muted',
  danger: 'bg-destructive text-white hover:brightness-110',
  ghost: 'text-muted-foreground hover:bg-muted hover:text-foreground',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-xs',
  md: 'h-9 px-3.5 text-sm',
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
        'disabled:cursor-not-allowed disabled:opacity-60',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    />
  );
}
