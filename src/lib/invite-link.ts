/** The token from a pasted invite link (or the token itself), or null. Safe in the browser. */
export function inviteToken(input: string) {
  const text = input.trim();
  const fromLink = /\/invite\/([A-Za-z0-9_-]{16,})/.exec(text)?.[1];
  return fromLink ?? (/^[A-Za-z0-9_-]{16,}$/.test(text) ? text : null);
}
