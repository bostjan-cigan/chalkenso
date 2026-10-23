/**
 * Where an improvement's change goes, as its plan says it on a last line of its own: "Scope: group
 * only" (this group's copy) or "Scope: group and core" (the main course's lesson too). That line,
 * in English whatever the page's language, is what the Obsidian vault, the AI and MCP read and
 * write; the app's plan editor hides it and sets it from its choice. Pure (unit-tested in
 * tests/e2e/unit-plan-scope.mjs).
 */

export type PlanScope = 'group only' | 'group and core';

const SCOPE_LINES = /^[ \t]*Scope:[ \t]*(.*?)[ \t]*$/gim;

/** What a "Scope:" line's words mean: anything naming the course or the core means both. */
function scopeOf(words: string): PlanScope | null {
  const value = words.toLowerCase().replace(/[.*_`"“”]/g, '').trim();
  if (!value) return null;
  if (/\b(core|course|main|both|all groups)\b/.test(value)) return 'group and core';
  if (/\bgroup\b/.test(value)) return 'group only';
  return null;
}

/** The scope the plan's last "Scope:" line names, or null when it names none. */
export function parsePlanScope(plan: string | null | undefined): PlanScope | null {
  let scope: PlanScope | null = null;
  Array.from((plan ?? '').matchAll(SCOPE_LINES)).forEach((match) => {
    scope = scopeOf(match[1]) ?? scope;
  });
  return scope;
}

/** The plan without its "Scope:" lines: what the plan editor shows. */
export function planBody(plan: string | null | undefined): string {
  return (plan ?? '')
    .replace(SCOPE_LINES, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The plan with one "Scope:" line at the end (none when `scope` is null). */
export function withPlanScope(plan: string | null | undefined, scope: PlanScope | null): string {
  const body = planBody(plan);
  if (!scope) return body;
  return body ? `${body}\n\nScope: ${scope}` : `Scope: ${scope}`;
}
