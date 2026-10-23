/**
 * Utility function for combining class names
 * Simple alternative to clsx/classnames
 */
export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ');
}

