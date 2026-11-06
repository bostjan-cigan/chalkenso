/**
 * "Sort with AI": all new feedback of a course version (or a group's copy) sorted at once, into
 * what changes in each lesson (a plan, and the notes it answers) and what's left out. A left-out
 * note keeps AI's `suggestion` for a reply apart from the person's `reply`: nothing is sent until
 * the person confirms or writes one. These are the pure parts, shared by the server and the page
 * (unit-tested in tests/e2e/unit-feedback-round.mjs).
 */

import type { PlanScope } from './plan-scope';

/** A note as AI reads it: its short reference ("N4"), its lesson's ("L3"). */
export type RoundNote = { id: string; ref: string; lessonId: string; lessonRef: string; body: string; passage: string; section: string | null; instructor: boolean; author: string };
/** A lesson as AI reads it: its reference, its sections, and its open improvement's plan. */
export type RoundLessonInput = { id: string; ref: string; position: number; title: string; sections: string[]; plan: string | null; reachesCourse: boolean };

/** AI's answer, before it's checked: references, not ids. */
export type RawRound = {
  lessons?: Array<{ lesson?: unknown; plan?: unknown; notes?: unknown; scope?: unknown }>;
  leaveOut?: Array<{ note?: unknown; suggestion?: unknown; reply?: unknown; duplicateOf?: unknown }>;
};

export type RoundLesson = { lessonId: string; plan: string; scope: PlanScope | null; noteIds: string[] };
export type RoundLeaveOut = { noteId: string; suggestion: string; reply: string; duplicateOf: string | null };
export type RoundPlan = { lessons: RoundLesson[]; leaveOut: RoundLeaveOut[] };

export const PLAN_MAX = 4000;
export const REPLY_MAX = 1000;

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const scopeOf = (value: unknown): PlanScope | null => (value === 'group only' || value === 'group and core' ? value : null);

/**
 * AI's answer made safe: references mapped back to ids (unknown ones dropped), every note in exactly
 * one place (the first wins), a change note on its own lesson's card, a duplicate of a note changed
 * on the same lesson joined to that change (it closes when the change reaches learners), any other
 * duplicate left out, and a note AI missed left out with no suggestion, for the person to decide.
 * Lessons come in course order; left-out notes in the order the notes came.
 */
export function cleanRound(raw: RawRound, notes: RoundNote[], lessons: RoundLessonInput[]): RoundPlan {
  const noteByRef = new Map(notes.map((note) => [note.ref, note]));
  const lessonByRef = new Map(lessons.map((lesson) => [lesson.ref, lesson]));
  const placed = new Set<string>();
  const cards = new Map<string, RoundLesson>();
  for (const item of Array.isArray(raw.lessons) ? raw.lessons : []) {
    const lesson = lessonByRef.get(String(item?.lesson ?? ''));
    if (!lesson) continue;
    const card = cards.get(lesson.id) ?? { lessonId: lesson.id, plan: '', scope: null, noteIds: [] };
    card.plan = text(item.plan, PLAN_MAX) || card.plan;
    card.scope = lesson.reachesCourse ? (scopeOf(item.scope) ?? card.scope) : null;
    for (const ref of Array.isArray(item.notes) ? item.notes : []) {
      const note = noteByRef.get(String(ref));
      // A note changes its own lesson only.
      if (!note || placed.has(note.id) || note.lessonId !== lesson.id) continue;
      card.noteIds.push(note.id);
      placed.add(note.id);
    }
    cards.set(lesson.id, card);
  }
  const leaveOut: RoundLeaveOut[] = [];
  for (const item of Array.isArray(raw.leaveOut) ? raw.leaveOut : []) {
    const note = noteByRef.get(String(item?.note ?? ''));
    if (!note || placed.has(note.id)) continue;
    const original = noteByRef.get(String(item.duplicateOf ?? ''));
    const duplicateOf = original && original.id !== note.id ? original.id : null;
    // The same as a note that changes this very lesson: it's answered by that change.
    const card = duplicateOf && original?.lessonId === note.lessonId ? cards.get(note.lessonId) : undefined;
    if (card?.noteIds.includes(duplicateOf as string)) {
      card.noteIds.push(note.id);
      placed.add(note.id);
      continue;
    }
    leaveOut.push({ noteId: note.id, suggestion: text(item.suggestion ?? item.reply, REPLY_MAX), reply: '', duplicateOf });
    placed.add(note.id);
  }
  // What AI didn't place: left out, for the person to decide (moved to its lesson, or answered).
  for (const note of notes) {
    if (placed.has(note.id)) continue;
    leaveOut.push({ noteId: note.id, suggestion: '', reply: '', duplicateOf: null });
    placed.add(note.id);
  }
  const position = new Map(lessons.map((lesson) => [lesson.id, lesson.position]));
  const order = new Map(notes.map((note, index) => [note.id, index]));
  return {
    lessons: Array.from(cards.values())
      .filter((card) => card.noteIds.length || card.plan)
      .sort((a, b) => (position.get(a.lessonId) ?? 0) - (position.get(b.lessonId) ?? 0)),
    leaveOut: leaveOut.sort((a, b) => (order.get(a.noteId) ?? 0) - (order.get(b.noteId) ?? 0)),
  };
}

/** Left-out notes without a reply the person confirmed or wrote: they stay open after Approve. */
export function leftToAnswer(round: RoundPlan): number {
  return round.leaveOut.filter((item) => !item.reply.trim()).length;
}

/**
 * The page's edits, checked against the round as sorted: only its notes, each once, on its own
 * lesson's card or left out; plans, scopes and replies capped. A note the edit lost is left out
 * (with its suggestion kept), never dropped.
 */
export function cleanEdit(edited: unknown, base: RoundPlan, lessons: Array<{ id: string; reachesCourse: boolean }>, noteLessons: Record<string, string>): RoundPlan {
  const value = (edited ?? {}) as { lessons?: unknown; leaveOut?: unknown };
  const known = new Set(Object.keys(noteLessons));
  const reaches = new Map(lessons.map((lesson) => [lesson.id, lesson.reachesCourse]));
  const suggestions = new Map(base.leaveOut.map((item) => [item.noteId, item.suggestion]));
  const placed = new Set<string>();
  const cards: RoundLesson[] = [];
  for (const raw of Array.isArray(value.lessons) ? value.lessons : []) {
    const item = raw as { lessonId?: unknown; plan?: unknown; scope?: unknown; noteIds?: unknown };
    const lessonId = String(item?.lessonId ?? '');
    if (!reaches.has(lessonId) || cards.some((card) => card.lessonId === lessonId)) continue;
    const noteIds = (Array.isArray(item.noteIds) ? item.noteIds : [])
      .map(String)
      .filter((id) => known.has(id) && !placed.has(id) && noteLessons[id] === lessonId);
    noteIds.forEach((id) => placed.add(id));
    cards.push({ lessonId, plan: text(item.plan, PLAN_MAX), scope: reaches.get(lessonId) ? scopeOf(item.scope) : null, noteIds });
  }
  const leaveOut: RoundLeaveOut[] = [];
  for (const raw of Array.isArray(value.leaveOut) ? value.leaveOut : []) {
    const item = raw as { noteId?: unknown; reply?: unknown; duplicateOf?: unknown };
    const noteId = String(item?.noteId ?? '');
    if (!known.has(noteId) || placed.has(noteId)) continue;
    placed.add(noteId);
    const duplicateOf = typeof item.duplicateOf === 'string' && known.has(item.duplicateOf) ? item.duplicateOf : null;
    leaveOut.push({ noteId, suggestion: suggestions.get(noteId) ?? '', reply: text(item.reply, REPLY_MAX), duplicateOf });
  }
  for (const noteId of Array.from(known)) {
    if (!placed.has(noteId)) leaveOut.push({ noteId, suggestion: suggestions.get(noteId) ?? '', reply: '', duplicateOf: null });
  }
  return { lessons: cards.filter((card) => card.noteIds.length || card.plan), leaveOut };
}

/**
 * For demos and tests (AI_MOCK=1), the same answer every time: thanks (no question) left out with
 * a suggested reply, a note repeating an earlier one's words a duplicate of it, everything else a
 * change on its own lesson, one plan line per note.
 */
export function mockRoundAnswer(notes: RoundNote[], lessons: RoundLessonInput[]): RawRound {
  const plans = new Map<string, { lines: string[]; notes: string[] }>();
  const leaveOut: NonNullable<RawRound['leaveOut']> = [];
  const seen = new Map<string, string>();
  const words = (body: string) => body.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  for (const note of notes) {
    const key = words(note.body);
    const thanks = /\b(thanks|thank you|great|love|hvala)\b/i.test(note.body) && !note.body.includes('?');
    if (thanks) {
      leaveOut.push({ note: note.ref, suggestion: 'Thank you, glad it helped!', duplicateOf: null });
      continue;
    }
    const earlier = seen.get(key);
    if (earlier) {
      leaveOut.push({ note: note.ref, suggestion: 'Thanks: someone asked the same, and we’re on it.', duplicateOf: earlier });
      continue;
    }
    seen.set(key, note.ref);
    const plan = plans.get(note.lessonRef) ?? { lines: [], notes: [] };
    plan.lines.push(`- In “${note.section ?? 'the lesson'}”, answer: ${note.body.replace(/\s+/g, ' ').slice(0, 120)}`);
    plan.notes.push(note.ref);
    plans.set(note.lessonRef, plan);
  }
  return {
    lessons: lessons
      .filter((lesson) => plans.has(lesson.ref))
      .map((lesson) => ({ lesson: lesson.ref, plan: plans.get(lesson.ref)?.lines.join('\n'), notes: plans.get(lesson.ref)?.notes, scope: lesson.reachesCourse ? 'group and core' : undefined })),
    leaveOut,
  };
}
