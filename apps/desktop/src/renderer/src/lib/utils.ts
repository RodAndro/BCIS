import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Conditional class names with Tailwind conflict resolution.
 *
 * `twMerge` matters when a component takes a `className` prop: without it,
 * `cn('p-2', 'p-4')` would emit both and the winner would depend on CSS source
 * order rather than on which the caller passed last.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
