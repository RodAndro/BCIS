import { cn } from '@renderer/lib/utils';
import type {
  InputHTMLAttributes,
  JSX,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { useId } from 'react';

/**
 * Form primitives.
 *
 * Every input is wrapped in a `Field` that owns the label, the hint, and the
 * error text, so the three cannot drift apart and each error is announced
 * against the control it belongs to.
 */

const CONTROL_CLASSES = cn(
  'w-full rounded-md border border-input bg-surface px-3 py-2 text-sm text-foreground shadow-sm',
  'transition-colors placeholder:text-muted-foreground',
  'hover:border-muted-foreground/50',
  'focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30',
  'disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:text-muted-foreground',
);

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  readonly invalid?: boolean;
}

export function Input({ className, invalid = false, ...rest }: InputProps): JSX.Element {
  return (
    <input
      className={cn(CONTROL_CLASSES, invalid && 'border-destructive', className)}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  readonly invalid?: boolean;
}

export function Select({
  className,
  invalid = false,
  children,
  ...rest
}: SelectProps): JSX.Element {
  return (
    <select
      className={cn(CONTROL_CLASSES, 'pr-8', invalid && 'border-destructive', className)}
      aria-invalid={invalid || undefined}
      {...rest}
    >
      {children}
    </select>
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  readonly invalid?: boolean;
}

export function Textarea({ className, invalid = false, ...rest }: TextareaProps): JSX.Element {
  return (
    <textarea
      className={cn(CONTROL_CLASSES, 'resize-y', invalid && 'border-destructive', className)}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
}

export interface FieldProps {
  readonly label: string;
  readonly hint?: ReactNode;
  readonly error?: string | null;
  readonly children: (props: { readonly id: string; readonly invalid: boolean }) => ReactNode;
}

export function Field({ label, hint, error, children }: FieldProps): JSX.Element {
  const id = useId();
  const invalid = error != null;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-semibold text-foreground">
        {label}
      </label>

      {children({ id, invalid })}

      {hint !== undefined && error == null && (
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      )}

      {error != null && (
        <p role="alert" className="text-[11px] text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export interface CheckboxRowProps {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly label: ReactNode;
  readonly disabled?: boolean;
}

export function CheckboxRow({
  checked,
  onChange,
  label,
  disabled = false,
}: CheckboxRowProps): JSX.Element {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-sm text-foreground">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
        className="mt-0.5 size-4 shrink-0 rounded border-input accent-accent"
      />
      <span>{label}</span>
    </label>
  );
}
