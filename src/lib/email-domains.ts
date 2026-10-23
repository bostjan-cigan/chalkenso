import 'server-only';

import { disposableEmailBlocklist } from 'disposable-email-domains-js';

/**
 * Throwaway email services (mailinator and the like) can't hold an account or book a call: the
 * list is the one PyPI uses (github.com/disposable-email-domains), through `disposable-email-domains-js`.
 * Update the package to get its newer list.
 */

let blocked: Set<string> | null = null;

/** Whether the email is at a throwaway service, or at one of its subdomains. */
export function isThrowawayEmail(email: string): boolean {
  const domain = email.trim().toLowerCase().split('@').pop() ?? '';
  blocked ??= new Set(disposableEmailBlocklist());
  const parts = domain.split('.');
  for (let index = 0; index < parts.length - 1; index += 1) {
    if (blocked.has(parts.slice(index).join('.'))) return true;
  }
  return false;
}
