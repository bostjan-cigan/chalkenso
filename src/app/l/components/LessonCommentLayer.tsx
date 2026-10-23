'use client';

import { useLocale, useTranslations } from 'next-intl';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { type IconType } from 'react-icons';
import { SiClaude, SiGooglegemini, SiOpenai, SiPerplexity } from 'react-icons/si';
// Type-only import; the runtime module is loaded client-side (its UMD bundle uses `self`, which
// breaks Next.js SSR), see the dynamic import in the init effect below.
import type HighlighterType from 'web-highlighter';
import { useAnnotationVisibility, type AnnotationKind } from './comments-visibility';
import { enhanceLessonCodeCopy } from './lesson-code-copy';
import { INTL_LOCALES, type Locale } from '@/i18n/config';
import { trackImageLoading } from '@/lib/image-skeleton';
import { findQuoteRange, normalizeWhitespace } from '@/lib/content/quote-range';
import styles from '../access.module.css';
import markdownStyles from '@/styles/markdown-content.module.css';
import '../access-lesson-copy.css';
import './lesson-comments.css';

/** A comment as rendered in the gutter (shared by viewer + admin modes). */
export type LessonCommentView = {
  id: string;
  selectedText: string;
  context: string | null;
  body: string;
  status: 'OPEN' | 'RESOLVED';
  adminResponse: string | null;
  createdAt: string;
  /** Admin mode, and team members' notes ("Name (instructor note)"). */
  proposerName?: string;
  /** Another instructor's name, on an instructor link (own comments have none). */
  author?: string | null;
  /** The reader's own, so they may delete it (absent: own, as a learner's always are). */
  mine?: boolean;
  /** Done, and the lesson has been published again since it was written: the change was made. */
  lessonChanged?: boolean;
};

/**
 * A private note as rendered in the gutter. Declared locally rather than imported from
 * `@/lib/lesson-notes`, which is `server-only`.
 */
export type LessonNoteView = {
  id: string;
  selectedText: string;
  context: string | null;
  body: string;
  createdAt: string;
  updatedAt: string;
};

type ViewerMode = {
  kind: 'viewer';
  token: string;
  proposerName: string;
  /**
   * Where comments and notes go. Learners use their access link (`/api/access/*`, the default);
   * team members annotate with their session (`/api/team/*`), where "feedback" is an instructor note.
   */
  api?: { comment: string; note: string };
  /** Label overrides for the feedback action (team: "Add instructor note"). */
  feedbackCopy?: { label: string; placeholder: string; submit: string };
  /** False hides the feedback action (read-only team members); private notes stay. Default true. */
  canComment?: boolean;
};

type AdminMode = {
  kind: 'admin';
  comments: LessonCommentView[];
  /** Link to triage this comment in the admin inbox. */
  inboxHref: string;
  /** Link to edit the lesson ("apply changes"). */
  lessonEditHref: string;
};

type LessonCommentLayerProps = {
  html: string;
  lessonId: string;
  mode: ViewerMode | AdminMode;
};

/** web-highlighter classes: base (any annotation), active (open/hover), pending (live selection). */
const HL_BASE = 'alc-hl';
const HL_ACTIVE = 'alc-hl-active';
const HL_PENDING = 'alc-hl-pending';
/** Per-kind classes, applied on top of the base class — see `repaintKinds`. */
const HL_KIND: Record<AnnotationKind, string> = {
  comment: 'alc-hl-comment',
  note: 'alc-hl-note',
};

/** One annotation, of either kind, as the highlight/gutter machinery sees it. */
type Target = { kind: AnnotationKind; id: string };

const targetKey = (target: Target) => `${target.kind}:${target.id}`;

const BUBBLE_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

const NOTE_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
  </svg>
);

function formatDate(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(INTL_LOCALES[locale], { dateStyle: 'medium' }).format(new Date(iso));
}

/**
 * AI assistants a reader can send the selected passage to (opens a fresh chat, prefilled).
 *
 * `prefillLimit` is how long a `?q=` prompt each site still accepts — measured against the live
 * sites, not documented anywhere. Past its limit a site silently discards the prompt and the new
 * tab lands on an empty chat or a landing page, so anything longer travels by clipboard instead.
 * ChatGPT is by far the tightest (1.5k works, 2k is already dropped).
 */
const AI_PROVIDERS: Array<{ key: string; label: string; Icon: IconType; prefillLimit: number }> = [
  { key: 'chatgpt', label: 'ChatGPT', Icon: SiOpenai, prefillLimit: 1500 },
  { key: 'claude', label: 'Claude', Icon: SiClaude, prefillLimit: 3000 },
  { key: 'gemini', label: 'Gemini', Icon: SiGooglegemini, prefillLimit: 2000 },
  { key: 'perplexity', label: 'Perplexity', Icon: SiPerplexity, prefillLimit: 6000 },
];

type AiProvider = (typeof AI_PROVIDERS)[number];

function buildAiUrl(provider: AiProvider, prompt: string): string {
  const q = prompt.length <= provider.prefillLimit ? encodeURIComponent(prompt) : '';
  switch (provider.key) {
    case 'chatgpt':
      return q ? `https://chatgpt.com/?q=${q}` : 'https://chatgpt.com/';
    case 'claude':
      return q ? `https://claude.ai/new?q=${q}` : 'https://claude.ai/new';
    case 'gemini':
      return q ? `https://gemini.google.com/app?q=${q}` : 'https://gemini.google.com/app';
    case 'perplexity':
      return q ? `https://www.perplexity.ai/search?q=${q}` : 'https://www.perplexity.ai/';
    default:
      return q ? `https://www.google.com/search?q=${q}` : 'https://www.google.com/';
  }
}

type Anchor = { kind: AnnotationKind; id: string; top: number };

/** 34px bubble + 4px breathing room. */
const BUBBLE_STRIDE = 38;

/**
 * Nudges bubbles apart so none is buried under another. Two annotations on the same passage measure
 * to an identical `top`, which would make the lower bubble unclickable — and that is the common
 * case once a passage can carry both feedback and a note.
 */
function decollide(raw: Anchor[]): Anchor[] {
  const sorted = [...raw].sort((a, b) => a.top - b.top);
  let previous = Number.NEGATIVE_INFINITY;
  return sorted.map((anchor) => {
    const top = Math.max(anchor.top, previous + BUBBLE_STRIDE);
    previous = top;
    return { ...anchor, top };
  });
}

type ToolbarState = {
  top: number;
  left: number;
  placement: 'above' | 'below';
  /** Kept so the width-aware clamp can re-run once the toolbar has been measured. */
  rawCenter: number;
  wrapWidth: number;
};

type AiComposeState = {
  top: number;
  left: number;
  selectedText: string;
  provider: AiProvider;
  /** Where in the lesson the passage is (for the page's own reading statistics, if any). */
  anchor: Element | null;
};

type ComposeState = {
  kind: AnnotationKind;
  top: number;
  left: number;
  selectedText: string;
  context: string | null;
};

/** How long each kind's text may be (its words are `learner.annotations.feedback` and `.note`). */
const MAX_LENGTH: Record<AnnotationKind, number> = { comment: 4000, note: 8000 };

export default function LessonCommentLayer({
  html,
  lessonId,
  mode,
}: LessonCommentLayerProps) {
  const t = useTranslations('learner.annotations');
  const tLessons = useTranslations('learner.lessons');
  const locale = useLocale();
  const copyCode = tLessons('copyCode');
  const copied = tLessons('copied');
  const wrapRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const highlighterRef = useRef<HighlighterType | null>(null);
  /** highlight id -> annotation (for click/hover → which annotation). */
  const hlToTarget = useRef<Map<string, Target>>(new Map());
  /** targetKey -> highlight id (for emphasis, kind repaint + repositioning). */
  const entryToHl = useRef<Map<string, string>>(new Map());
  /** The live-selection highlight id awaiting an action (removed on dismiss). */
  const pendingHlId = useRef<string | null>(null);

  const [comments, setComments] = useState<LessonCommentView[]>(
    mode.kind === 'admin' ? mode.comments : []
  );
  const [notes, setNotes] = useState<LessonNoteView[]>([]);
  const [anchors, setAnchors] = useState<Anchor[]>([]);
  const [openTarget, setOpenTarget] = useState<Target | null>(null);
  const [emphasisTarget, setEmphasisTarget] = useState<Target | null>(null);

  const [toolbar, setToolbar] = useState<ToolbarState | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiCompose, setAiCompose] = useState<AiComposeState | null>(null);
  const [aiContext, setAiContext] = useState('');
  const [compose, setCompose] = useState<ComposeState | null>(null);
  const [composeText, setComposeText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const editingRef = useRef(false);
  const [editText, setEditText] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  /** Bumped once the highlighter is ready so the restore effect runs after it exists. */
  const [ready, setReady] = useState(0);
  /** Global reader toggles (shared across all lessons) hide each kind's highlights + bubbles. */
  const { visible, reveal, reportCount } = useAnnotationVisibility();
  const visibleRef = useRef<Record<AnnotationKind, boolean>>({ comment: true, note: true });

  const pendingSelection = useRef<{
    selectedText: string;
    context: string | null;
    composeTop: number;
    composeLeft: number;
    anchor: Element | null;
  } | null>(null);

  /**
   * Effects key off this string rather than the `openTarget` object — an object in a dependency
   * array re-fires whenever it is reconstructed during render.
   */
  const openKey = openTarget ? targetKey(openTarget) : null;
  const emphasisKey = emphasisTarget ? targetKey(emphasisTarget) : null;

  const commentsById = useMemo(() => {
    const map = new Map<string, LessonCommentView>();
    comments.forEach((comment) => map.set(comment.id, comment));
    return map;
  }, [comments]);

  const notesById = useMemo(() => {
    const map = new Map<string, LessonNoteView>();
    notes.forEach((note) => map.set(note.id, note));
    return map;
  }, [notes]);

  /**
   * Every annotation on the lesson, in a stable order. Notes come last on purpose: on a passage
   * carrying both, the wrapper's primary `data-highlight-id` is whichever highlight was created
   * last, and web-highlighter's CLICK event only reports that primary id — so clicking doubly
   * marked text opens the private, editable note.
   */
  const entries = useMemo(
    () => [
      ...comments.map((comment) => ({
        kind: 'comment' as const,
        id: comment.id,
        quote: comment.selectedText,
      })),
      ...notes.map((note) => ({ kind: 'note' as const, id: note.id, quote: note.selectedText })),
    ],
    [comments, notes]
  );

  const getRoot = useCallback((): HTMLElement | null => {
    return contentRef.current;
  }, []);

  /**
   * Re-derives every wrapper's kind classes from the annotations that currently own it. This is
   * required, not belt-and-braces, and it has to both add and remove:
   *
   * - web-highlighter wipes a wrapper's classList in `wrapOverlapNode` (painter/dom.js) when a new
   *   highlight covers an existing one, and again in `removeHighlight`'s id-update branch
   *   (painter/index.js) when one of two overlapping highlights is deleted, re-adding only the
   *   constructor's base class — so kind classes have to be put back.
   * - Deleting one of two annotations sharing a wrapper leaves the wrapper in place (the other one
   *   still owns it), so the departed kind's class has to come off or the passage keeps its colour.
   *
   * Working from the live DOM rather than from ids alone is what makes the removal correct: a
   * wrapper we no longer have any id for simply ends up with no kind class.
   */
  const repaintKinds = useCallback(() => {
    const highlighter = highlighterRef.current;
    const root = getRoot();
    if (!highlighter || !root) {
      return;
    }

    // `getDoms` resolves a highlight by both its primary and its extra ids, so a shared wrapper is
    // reached from each annotation that owns it.
    const kindsByElement = new Map<Element, Set<AnnotationKind>>();
    entryToHl.current.forEach((hlId, key) => {
      const kind: AnnotationKind = key.startsWith('note:') ? 'note' : 'comment';
      highlighter.getDoms(hlId).forEach((element) => {
        const kinds = kindsByElement.get(element) ?? new Set<AnnotationKind>();
        kinds.add(kind);
        kindsByElement.set(element, kinds);
      });
    });

    root.querySelectorAll('span[data-highlight-id]').forEach((element) => {
      const kinds = kindsByElement.get(element);
      (Object.keys(HL_KIND) as AnnotationKind[]).forEach((kind) => {
        element.classList.toggle(HL_KIND[kind], kinds?.has(kind) ?? false);
      });
    });
  }, [getRoot]);

  // Render the lesson HTML imperatively so React never reconciles (and wipes) the highlight spans
  // that web-highlighter injects into it.
  useEffect(() => {
    const el = contentRef.current;
    if (!el) {
      return;
    }
    el.innerHTML = html;
    const disposeCopy = enhanceLessonCodeCopy(el, { copyCode, copied });
    const disposeImages = trackImageLoading(el);
    return () => {
      disposeCopy();
      disposeImages();
    };
  }, [html, copyCode, copied]);

  // Keep a ref of the toggles so the highlighter's click/hover handlers can honor them; close
  // anything of a kind that just became hidden.
  useEffect(() => {
    visibleRef.current = visible;
    setOpenTarget((current) => (current && !visible[current.kind] ? null : current));
    setEmphasisTarget((current) => (current && !visible[current.kind] ? null : current));
  }, [visible]);

  // Report this lesson's counts so the shared floating toggle knows which rows to show. The cleanup
  // matters: without it a collapsed lesson's counts would linger and keep its row on screen.
  useEffect(() => {
    reportCount(lessonId, { comment: comments.length, note: notes.length });
    return () => reportCount(lessonId, { comment: 0, note: 0 });
  }, [comments.length, notes.length, lessonId, reportCount]);

  // Track the mobile breakpoint (popovers become a bottom sheet, so drop inline positioning).
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 560px)');
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  // Create the highlighter over the lesson content ONCE; wire click/hover to open/emphasize.
  // web-highlighter is imported dynamically (client-only) because its UMD bundle references `self`.
  useEffect(() => {
    let disposed = false;
    let created: HighlighterType | null = null;

    import('web-highlighter')
      .then(({ default: Highlighter }) => {
        const root = getRoot();
        if (disposed || !root) {
          return;
        }
        const highlighter = new Highlighter({
          $root: root,
          wrapTag: 'span',
          style: { className: HL_BASE },
          exceptSelectors: ['pre', 'code', '.lesson-code-block', 'a'],
        });

        highlighter.on(Highlighter.event.CLICK, ({ id }) => {
          const target = hlToTarget.current.get(id);
          if (!target || !visibleRef.current[target.kind]) {
            return;
          }
          setOpenTarget((current) =>
            current && current.kind === target.kind && current.id === target.id ? null : target
          );
        });
        highlighter.on(Highlighter.event.HOVER, ({ id }) => {
          const target = hlToTarget.current.get(id);
          if (!target || !visibleRef.current[target.kind]) {
            return;
          }
          setEmphasisTarget(target);
        });
        highlighter.on(Highlighter.event.HOVER_OUT, () => setEmphasisTarget(null));

        created = highlighter;
        highlighterRef.current = highlighter;
        hlToTarget.current.clear();
        entryToHl.current.clear();
        pendingHlId.current = null;
        setReady((value) => value + 1);
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      created?.dispose();
      highlighterRef.current = null;
      hlToTarget.current.clear();
      entryToHl.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Render annotation highlights from their stored quotes (idempotent) and place the gutter bubbles.
  useEffect(() => {
    const highlighter = highlighterRef.current;
    const wrap = wrapRef.current;
    const root = getRoot();
    if (!highlighter || !wrap || !root) {
      return;
    }

    const wrapTop = wrap.getBoundingClientRect().top;
    const nextAnchors: Anchor[] = [];

    for (const entry of entries) {
      const key = targetKey(entry);
      // Only create a highlight the first time we see this annotation (avoids remove/re-add churn).
      let hlId = entryToHl.current.get(key);
      if (!hlId) {
        const range = findQuoteRange(root, entry.quote);
        if (range) {
          try {
            const source = highlighter.fromRange(range);
            hlId = source.id;
            hlToTarget.current.set(hlId, { kind: entry.kind, id: entry.id });
            entryToHl.current.set(key, hlId);
          } catch {
            /* skip a passage that can't be highlighted */
          }
        }
      }

      let top = 0;
      if (hlId) {
        const dom = highlighter.getDoms(hlId)[0];
        if (dom) {
          top = dom.getBoundingClientRect().top - wrapTop;
        }
      }
      nextAnchors.push({ kind: entry.kind, id: entry.id, top });
    }

    repaintKinds();
    setAnchors(decollide(nextAnchors));
  }, [entries, ready, getRoot, repaintKinds]);

  // Reposition bubbles on resize / font load (highlight DOM stays; only offsets change).
  useEffect(() => {
    const reposition = () => {
      const highlighter = highlighterRef.current;
      const wrap = wrapRef.current;
      if (!highlighter || !wrap) {
        return;
      }
      const wrapTop = wrap.getBoundingClientRect().top;
      setAnchors((current) =>
        decollide(
          current.map((anchor) => {
            const hlId = entryToHl.current.get(targetKey(anchor));
            const dom = hlId ? highlighter.getDoms(hlId)[0] : null;
            return dom ? { ...anchor, top: dom.getBoundingClientRect().top - wrapTop } : anchor;
          })
        )
      );
    };
    window.addEventListener('resize', reposition);
    const fonts = (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts;
    fonts?.ready.then(reposition).catch(() => undefined);
    return () => window.removeEventListener('resize', reposition);
  }, []);

  // Emphasize the open/hovered annotation's highlight.
  useEffect(() => {
    const highlighter = highlighterRef.current;
    if (!highlighter) {
      return;
    }
    const activeKey = openKey ?? emphasisKey;
    entryToHl.current.forEach((hlId, key) => {
      if (key === activeKey) {
        highlighter.addClass(HL_ACTIVE, hlId);
      } else {
        highlighter.removeClass(HL_ACTIVE, hlId);
      }
    });
  }, [openKey, emphasisKey, anchors]);

  const commentApi = mode.kind === 'viewer' ? mode.api?.comment ?? '/api/access/comment' : '/api/access/comment';
  const noteApi = mode.kind === 'viewer' ? mode.api?.note ?? '/api/access/note' : '/api/access/note';
  const composeCopy = (kind: AnnotationKind) => {
    const words = kind === 'comment' ? 'feedback' : 'note';
    const copy = {
      label: t(`${words}.label`),
      placeholder: t(`${words}.placeholder`),
      submit: t(`${words}.submit`),
      submitting: t(`${words}.submitting`),
      maxLength: MAX_LENGTH[kind],
    };
    return kind === 'comment' && mode.kind === 'viewer' && mode.feedbackCopy ? { ...copy, ...mode.feedbackCopy } : copy;
  };
  /** What goes to the assistant: the passage, after the reader's own question when they wrote one. */
  const buildAiPrompt = useCallback(
    (text: string, context: string) => (context ? t('aiPromptWithContext', { context, text }) : t('aiPrompt', { text })),
    [t]
  );

  // Viewer: load this link's comments for the lesson.
  useEffect(() => {
    if (mode.kind !== 'viewer') {
      return;
    }
    let cancelled = false;
    const params = new URLSearchParams({ token: mode.token, lessonId });
    fetch(`${commentApi}?${params.toString()}`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : { comments: [] }))
      .then((payload: { comments?: LessonCommentView[] }) => {
        if (!cancelled) {
          setComments(payload.comments ?? []);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [mode, lessonId, commentApi]);

  // Viewer: load this reader's own private notes for the lesson.
  useEffect(() => {
    if (mode.kind !== 'viewer') {
      return;
    }
    let cancelled = false;
    const params = new URLSearchParams({ token: mode.token, lessonId });
    fetch(`${noteApi}?${params.toString()}`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : { notes: [] }))
      .then((payload: { notes?: LessonNoteView[] }) => {
        if (!cancelled) {
          setNotes(payload.notes ?? []);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [mode, lessonId, noteApi]);

  /** Remove the live-selection highlight, if any. */
  const clearPending = useCallback(() => {
    const highlighter = highlighterRef.current;
    if (highlighter && pendingHlId.current) {
      highlighter.remove(pendingHlId.current);
      // Removing an overlapping highlight strips classes off the wrapper it shared.
      repaintKinds();
    }
    pendingHlId.current = null;
  }, [repaintKinds]);

  // Viewer: raise the Medium-style toolbar on a text selection, and paint the pending highlight.
  useEffect(() => {
    if (mode.kind !== 'viewer') {
      return;
    }

    const onMouseUp = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest('.alc-toolbar, .alc-popover')) {
        return;
      }
      if (compose || aiCompose) {
        return;
      }
      const wrap = wrapRef.current;
      const root = getRoot();
      const highlighter = highlighterRef.current;
      if (!wrap || !root || !highlighter) {
        return;
      }
      const selection = window.getSelection();
      const dismiss = () => {
        setToolbar(null);
        setAiOpen(false);
        clearPending();
      };
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        dismiss();
        return;
      }
      const range = selection.getRangeAt(0);
      if (!root.contains(range.commonAncestorContainer)) {
        dismiss();
        return;
      }
      const selectedText = normalizeWhitespace(selection.toString());
      if (!selectedText) {
        dismiss();
        return;
      }

      const anchorEl =
        range.startContainer.nodeType === Node.ELEMENT_NODE
          ? (range.startContainer as HTMLElement)
          : range.startContainer.parentElement;
      const block = anchorEl?.closest('p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, td');
      const context = block ? normalizeWhitespace(block.textContent ?? '') : null;

      const rects = range.getClientRects();
      const firstRect = rects[0] ?? range.getBoundingClientRect();
      const lastRect = rects[rects.length - 1] ?? firstRect;
      const wrapRect = wrap.getBoundingClientRect();
      const rawCenter = (firstRect.left + lastRect.right) / 2 - wrapRect.left;
      // First guess for a three-action toolbar; the layout effect below re-clamps it once measured.
      const half = 175;
      const toolbarLeft = Math.min(
        Math.max(rawCenter, half),
        Math.max(half, wrapRect.width - half)
      );
      const composeLeft = Math.min(
        Math.max(rawCenter, 12),
        Math.max(12, wrapRect.width - 332)
      );
      const aboveTop = firstRect.top - wrapRect.top - 10;
      const belowTop = lastRect.bottom - wrapRect.top + 10;
      const placement: 'above' | 'below' = aboveTop < 44 ? 'below' : 'above';

      // Paint the persistent hue immediately so the reader sees what they marked.
      clearPending();
      try {
        const source = highlighter.fromRange(range.cloneRange());
        pendingHlId.current = source.id;
        highlighter.addClass(HL_PENDING, source.id);
        // The new wrapper may have swallowed an existing annotation's classes.
        repaintKinds();
      } catch {
        /* highlight is a nicety; ignore if it can't be wrapped */
      }

      pendingSelection.current = {
        selectedText,
        context,
        composeTop: lastRect.bottom - wrapRect.top + 8,
        composeLeft,
        anchor: anchorEl ?? null,
      };
      setToolbar({
        top: placement === 'above' ? aboveTop : belowTop,
        left: toolbarLeft,
        placement,
        rawCenter,
        wrapWidth: wrapRect.width,
      });
      setAiOpen(false);
    };

    document.addEventListener('mouseup', onMouseUp);
    return () => document.removeEventListener('mouseup', onMouseUp);
  }, [mode, getRoot, compose, aiCompose, clearPending, repaintKinds]);

  /**
   * Re-clamp the toolbar against its measured width. The estimate above assumes a fixed size, but
   * three actions plus the Ask AI chevron vary enough that a guess lets it hang off the edge.
   */
  useLayoutEffect(() => {
    const el = toolbarRef.current;
    if (!toolbar || !el) {
      return;
    }
    const half = el.offsetWidth / 2;
    const next = Math.min(
      Math.max(toolbar.rawCenter, half),
      Math.max(half, toolbar.wrapWidth - half)
    );
    if (Math.abs(next - toolbar.left) > 0.5) {
      setToolbar((current) => (current ? { ...current, left: next } : current));
    }
  }, [toolbar]);

  // Dismiss the toolbar (and its hue) on Escape.
  useEffect(() => {
    if (!toolbar) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setToolbar(null);
        setAiOpen(false);
        clearPending();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [toolbar, clearPending]);

  const openCompose = useCallback((kind: AnnotationKind) => {
    const pending = pendingSelection.current;
    if (!pending) {
      return;
    }
    setCompose({
      kind,
      top: pending.composeTop,
      left: pending.composeLeft,
      selectedText: pending.selectedText,
      context: pending.context,
    });
    setComposeText('');
    setError(null);
    setToolbar(null);
    setAiOpen(false);
    setOpenTarget(null);
    window.getSelection()?.removeAllRanges();
  }, []);

  const closeCompose = useCallback(() => {
    clearPending();
    setCompose(null);
    setComposeText('');
    setError(null);
  }, [clearPending]);

  /** Step two of Ask AI: the chosen provider plus an optional context field, like feedback. */
  const openAiCompose = useCallback((providerKey: string) => {
    const pending = pendingSelection.current;
    const provider = AI_PROVIDERS.find((item) => item.key === providerKey);
    if (!pending || !provider) {
      return;
    }
    setAiCompose({
      top: pending.composeTop,
      left: pending.composeLeft,
      selectedText: pending.selectedText,
      provider,
      anchor: pending.anchor,
    });
    setAiContext('');
    setToolbar(null);
    setAiOpen(false);
    setOpenTarget(null);
    window.getSelection()?.removeAllRanges();
  }, []);

  const closeAiCompose = useCallback(() => {
    clearPending();
    setAiCompose(null);
    setAiContext('');
  }, [clearPending]);

  // Close the Ask AI popover on an outside click or Escape.
  useEffect(() => {
    if (!aiCompose) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest('.alc-popover')) {
        return;
      }
      closeAiCompose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeAiCompose();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [aiCompose, closeAiCompose]);

  const sendToAi = useCallback(() => {
    if (!aiCompose) {
      return;
    }
    const prompt = buildAiPrompt(aiCompose.selectedText, aiContext.trim());
    // Every assistant has its own way of losing a prompt handed over in a URL — a length cap, a
    // sign-in redirect, or simply ignoring `?q=` — so the prompt always goes to the clipboard too.
    navigator.clipboard?.writeText(prompt).catch(() => undefined);
    window.open(buildAiUrl(aiCompose.provider, prompt), '_blank', 'noopener,noreferrer');
    // Lets an edition's reading statistics count where readers ask for help (a count, never the text).
    window.dispatchEvent(new CustomEvent('chalkenso:ask-ai', { detail: { anchor: aiCompose.anchor } }));
    closeAiCompose();
  }, [aiCompose, aiContext, closeAiCompose, buildAiPrompt]);

  const submitEntry = useCallback(async () => {
    if (mode.kind !== 'viewer' || !compose) {
      return;
    }
    const body = composeText.trim();
    if (!body) {
      setError(t('writeFirst'));
      return;
    }
    const isNote = compose.kind === 'note';
    const fallbackError = isNote ? t('saveNoteFailed') : t('saveCommentFailed');
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(isNote ? noteApi : commentApi, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: mode.token,
          lessonId,
          selectedText: compose.selectedText,
          context: compose.context,
          body,
        }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? fallbackError);
      }
      const payload = (await res.json()) as {
        comment?: LessonCommentView;
        note?: LessonNoteView;
      };
      clearPending();
      if (isNote && payload.note) {
        setNotes((current) => [payload.note as LessonNoteView, ...current]);
      } else if (!isNote && payload.comment) {
        setComments((current) => [payload.comment as LessonCommentView, ...current]);
      }
      // Both kinds start hidden, so without this the reader watches what they just wrote disappear.
      reveal(compose.kind);
      setCompose(null);
      setComposeText('');
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : fallbackError);
    } finally {
      setSubmitting(false);
    }
  }, [mode, compose, composeText, lessonId, clearPending, reveal, commentApi, noteApi, t]);

  const deleteEntry = useCallback(
    async (target: Target) => {
      if (mode.kind !== 'viewer') {
        return;
      }
      const isNote = target.kind === 'note';
      const fallbackError = isNote ? t('deleteNoteFailed') : t('deleteCommentFailed');
      setDeleting(true);
      setDeleteError(null);
      try {
        const params = new URLSearchParams(
          isNote
            ? { token: mode.token, noteId: target.id }
            : { token: mode.token, commentId: target.id }
        );
        const path = isNote ? noteApi : commentApi;
        const res = await fetch(`${path}?${params.toString()}`, {
          method: 'DELETE',
          cache: 'no-store',
        });
        if (!res.ok) {
          const payload = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error ?? fallbackError);
        }
        // Drop its highlight + mappings so the passage is unmarked and the bubble disappears.
        const key = targetKey(target);
        const hlId = entryToHl.current.get(key);
        if (hlId) {
          highlighterRef.current?.remove(hlId);
          hlToTarget.current.delete(hlId);
          entryToHl.current.delete(key);
          // A wrapper shared with another annotation loses its classes on removal.
          repaintKinds();
        }
        if (isNote) {
          setNotes((current) => current.filter((note) => note.id !== target.id));
        } else {
          setComments((current) => current.filter((comment) => comment.id !== target.id));
        }
        setOpenTarget(null);
        setEmphasisTarget(null);
        setConfirmDelete(false);
      } catch (removeError) {
        setDeleteError(removeError instanceof Error ? removeError.message : fallbackError);
      } finally {
        setDeleting(false);
      }
    },
    [mode, repaintKinds, commentApi, noteApi, t]
  );

  const saveNoteEdit = useCallback(
    async (noteId: string) => {
      if (mode.kind !== 'viewer') {
        return;
      }
      const body = editText.trim();
      if (!body) {
        setEditError(t('noteEmpty'));
        return;
      }
      setSavingEdit(true);
      setEditError(null);
      try {
        const res = await fetch(noteApi, {
          method: 'PATCH',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: mode.token, noteId, body }),
        });
        if (!res.ok) {
          const payload = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error ?? t('saveNoteFailed'));
        }
        const payload = (await res.json()) as { note: LessonNoteView };
        // Only the body changed, so the highlight anchor is untouched — no re-highlighting needed.
        setNotes((current) =>
          current.map((note) => (note.id === noteId ? payload.note : note))
        );
        setEditing(false);
        setEditText('');
      } catch (saveError) {
        setEditError(
          saveError instanceof Error ? saveError.message : t('saveNoteFailed')
        );
      } finally {
        setSavingEdit(false);
      }
    },
    [mode, editText, noteApi, t]
  );

  // Reset the delete confirmation and any in-progress edit whenever a different annotation is
  // opened (or the popover closes).
  useEffect(() => {
    setConfirmDelete(false);
    setDeleteError(null);
    setEditing(false);
    setEditText('');
    setEditError(null);
  }, [openKey]);

  useEffect(() => {
    editingRef.current = editing;
  }, [editing]);

  // Close the popover on an outside click or Escape (clicks on a bubble/highlight are handled by
  // their own toggles, so ignore those).
  useEffect(() => {
    if (!openKey) {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest('.alc-popover, .alc-bubble, .alc-hl')
      ) {
        return;
      }
      setOpenTarget(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }
      // While a note is being edited, Escape backs out of the edit and keeps the note on screen.
      if (editingRef.current) {
        setEditing(false);
        setEditError(null);
        return;
      }
      setOpenTarget(null);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [openKey]);

  const wrapActive = comments.length > 0 || notes.length > 0 || mode.kind === 'viewer';
  const openComment =
    openTarget?.kind === 'comment' ? commentsById.get(openTarget.id) ?? null : null;
  const openNote = openTarget?.kind === 'note' ? notesById.get(openTarget.id) ?? null : null;
  const openAnchorTop = openTarget
    ? anchors.find((anchor) => targetKey(anchor) === openKey)?.top ?? 0
    : 0;

  return (
    <div
      className="alc-wrap"
      data-alc-active={wrapActive}
      data-alc-comments-hidden={!visible.comment}
      data-alc-notes-hidden={!visible.note}
      ref={wrapRef}
    >
      <div ref={contentRef} className={`${styles.lessonContent} ${markdownStyles.markdownContent}`} data-access-lesson-root />


      <div className="alc-gutter" aria-hidden={anchors.length === 0}>
        {anchors.map((anchor) => {
          const isNote = anchor.kind === 'note';
          const entry = isNote ? notesById.get(anchor.id) : commentsById.get(anchor.id);
          if (!entry) {
            return null;
          }
          const key = targetKey(anchor);
          return (
            <button
              key={key}
              type="button"
              className="alc-bubble"
              style={{ top: anchor.top }}
              data-alc-kind={anchor.kind}
              data-alc-status={isNote ? undefined : (entry as LessonCommentView).status}
              data-alc-emphasis={emphasisKey === key}
              aria-expanded={openKey === key}
              aria-label={isNote ? t('noteBubble', { text: entry.body.slice(0, 60) }) : t('feedbackBubble', { text: entry.body.slice(0, 60) })}
              onMouseEnter={() => setEmphasisTarget({ kind: anchor.kind, id: anchor.id })}
              onMouseLeave={() => setEmphasisTarget(null)}
              onClick={() =>
                setOpenTarget((current) =>
                  current && targetKey(current) === key
                    ? null
                    : { kind: anchor.kind, id: anchor.id }
                )
              }
            >
              {isNote ? NOTE_ICON : BUBBLE_ICON}
            </button>
          );
        })}
      </div>

      {mode.kind === 'viewer' && toolbar ? (
        <div
          className="alc-toolbar"
          ref={toolbarRef}
          data-placement={toolbar.placement}
          style={{ top: toolbar.top, left: toolbar.left }}
          onMouseDown={(event) => event.preventDefault()}
        >
          {mode.canComment === false ? null : (
          <button
            type="button"
            className="alc-tb-item"
            onMouseDown={(event) => {
              event.preventDefault();
              openCompose('comment');
            }}
          >
            {BUBBLE_ICON}
            {mode.kind === 'viewer' && mode.feedbackCopy ? mode.feedbackCopy.label : t('feedback.label')}
          </button>
          )}
          <button
            type="button"
            className="alc-tb-item"
            data-alc-kind="note"
            onMouseDown={(event) => {
              event.preventDefault();
              openCompose('note');
            }}
          >
            {NOTE_ICON}
            {t('toolbarNote')}
          </button>
          <span className="alc-tb-sep" aria-hidden />
          <button
            type="button"
            className="alc-tb-item"
            aria-expanded={aiOpen}
            onMouseDown={(event) => {
              event.preventDefault();
              setAiOpen((open) => !open);
            }}
          >
            <SiOpenai aria-hidden />
            {t('askAi')}
            <span
              className={aiOpen ? 'alc-tb-chevron alc-tb-chevron-open' : 'alc-tb-chevron'}
              aria-hidden
            >
              ▾
            </span>
          </button>

          {aiOpen ? (
            <div className="alc-tb-dropdown">
              {AI_PROVIDERS.map((provider) => {
                const Icon = provider.Icon;
                return (
                  <button
                    key={provider.key}
                    type="button"
                    className="alc-tb-ai"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      openAiCompose(provider.key);
                    }}
                  >
                    <Icon aria-hidden />
                    {provider.label}
                  </button>
                );
              })}
            </div>
          ) : null}

          <span className="alc-tb-caret" aria-hidden />
        </div>
      ) : null}

      {mode.kind === 'viewer' && aiCompose ? (
        <div
          className="alc-popover"
          style={isMobile ? undefined : { top: Math.max(aiCompose.top, 0), left: aiCompose.left }}
          role="dialog"
          aria-label={t('askProvider', { provider: aiCompose.provider.label })}
        >
          <div className="alc-popover-ai-head">
            <aiCompose.provider.Icon aria-hidden />
            <span>{t('askProvider', { provider: aiCompose.provider.label })}</span>
          </div>
          <textarea
            className="alc-textarea"
            placeholder={t('aiContextPlaceholder')}
            value={aiContext}
            onChange={(event) => setAiContext(event.target.value)}
            autoFocus
            maxLength={1000}
          />
          <p className="alc-empty-hint">
            {buildAiPrompt(aiCompose.selectedText, aiContext.trim()).length >
            aiCompose.provider.prefillLimit
              ? t('aiTooLong', { provider: aiCompose.provider.label })
              : t('aiCopied', { provider: aiCompose.provider.label })}
          </p>
          <div className="alc-actions">
            <button type="button" className="alc-btn alc-btn-ghost" onClick={closeAiCompose}>
              {t('cancel')}
            </button>
            <button type="button" className="alc-btn alc-btn-primary" onClick={sendToAi}>
              {t('openProvider', { provider: aiCompose.provider.label })}
            </button>
          </div>
        </div>
      ) : null}

      {mode.kind === 'viewer' && compose ? (
        <div
          className="alc-popover"
          data-alc-kind={compose.kind}
          style={isMobile ? undefined : { top: Math.max(compose.top, 0), left: compose.left }}
          role="dialog"
          aria-label={composeCopy(compose.kind).label}
        >
          <p className="alc-popover-quote">{t('quote', { text: compose.selectedText })}</p>
          <textarea
            className="alc-textarea"
            placeholder={composeCopy(compose.kind).placeholder}
            value={composeText}
            onChange={(event) => setComposeText(event.target.value)}
            autoFocus
            maxLength={composeCopy(compose.kind).maxLength}
          />
          {error ? <p className="alc-error">{error}</p> : null}
          <div className="alc-actions">
            <button
              type="button"
              className="alc-btn alc-btn-ghost"
              onClick={closeCompose}
              disabled={submitting}
            >
              {t('cancel')}
            </button>
            <button
              type="button"
              className="alc-btn alc-btn-primary"
              onClick={submitEntry}
              disabled={submitting}
            >
              {submitting
                ? composeCopy(compose.kind).submitting
                : composeCopy(compose.kind).submit}
            </button>
          </div>
        </div>
      ) : null}

      {openComment ? (
        <div
          className="alc-popover"
          data-alc-kind="comment"
          style={isMobile ? undefined : { top: Math.max(openAnchorTop - 6, 0), right: 64 }}
          role="dialog"
          aria-label={t('comment')}
        >
          <div className="alc-popover-meta">
            <span>
              {openComment.proposerName ?? openComment.author ?? (mode.kind === 'viewer' ? t('you') : t('reader'))}
              {' · '}
              {formatDate(openComment.createdAt, locale)}
            </span>
            <span className="alc-status-pill" data-alc-status={openComment.status}>
              {openComment.status === 'RESOLVED' ? (openComment.lessonChanged ? t('resolvedChanged') : t('resolved')) : t('open')}
            </span>
          </div>
          <p className="alc-popover-quote">{t('quote', { text: openComment.selectedText })}</p>
          <p className="alc-popover-body">{openComment.body}</p>

          {openComment.adminResponse ? (
            <div className="alc-response">
              <p className="alc-response-label">{t('response')}</p>
              <p className="alc-response-body">{openComment.adminResponse}</p>
            </div>
          ) : mode.kind === 'viewer' ? (
            <p className="alc-empty-hint">{t('noResponse')}</p>
          ) : null}

          {mode.kind === 'admin' ? (
            <div className="alc-actions" style={{ justifyContent: 'space-between' }}>
              <a className="alc-link" href={mode.lessonEditHref}>
                {t('editLesson')}
              </a>
              <a className="alc-link" href={`${mode.inboxHref}#comment-${openComment.id}`}>
                {t('openInInbox')}
              </a>
            </div>
          ) : (
            <>
              {deleteError ? <p className="alc-error">{deleteError}</p> : null}
              {confirmDelete ? (
                <div className="alc-actions">
                  <span className="alc-confirm-text">{t('deleteComment')}</span>
                  <button
                    type="button"
                    className="alc-btn alc-btn-ghost"
                    onClick={() => setConfirmDelete(false)}
                    disabled={deleting}
                  >
                    {t('keep')}
                  </button>
                  <button
                    type="button"
                    className="alc-btn alc-btn-danger"
                    onClick={() => deleteEntry({ kind: 'comment', id: openComment.id })}
                    disabled={deleting}
                  >
                    {deleting ? t('deleting') : t('delete')}
                  </button>
                </div>
              ) : (
                <div className="alc-actions" style={{ justifyContent: 'space-between' }}>
                  {/* Only your own: others' notes (team view, instructor links) can't be deleted here. */}
                  {openComment.mine === false ? (
                    <span />
                  ) : (
                    <button
                      type="button"
                      className="alc-btn alc-btn-text-danger"
                      onClick={() => setConfirmDelete(true)}
                    >
                      {t('delete')}
                    </button>
                  )}
                  <button
                    type="button"
                    className="alc-btn alc-btn-ghost"
                    onClick={() => setOpenTarget(null)}
                  >
                    {t('close')}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      ) : null}

      {openNote ? (
        <div
          className="alc-popover"
          data-alc-kind="note"
          style={isMobile ? undefined : { top: Math.max(openAnchorTop - 6, 0), right: 64 }}
          role="dialog"
          aria-label={t('notePill')}
        >
          <div className="alc-popover-meta">
            <span>
              {formatDate(openNote.createdAt, locale)}
              {openNote.updatedAt !== openNote.createdAt ? t('edited') : ''}
            </span>
            <span className="alc-status-pill" data-alc-kind="note">
              {t('notePill')}
            </span>
          </div>
          <p className="alc-popover-quote">{t('quote', { text: openNote.selectedText })}</p>

          {editing ? (
            <textarea
              className="alc-textarea"
              value={editText}
              onChange={(event) => setEditText(event.target.value)}
              onKeyDown={(event) => {
                // Escape is handled by the document listener below, which knows to back out of the
                // edit rather than the popover. Doing it here instead cannot work: Next hydrates
                // `document`, so React's delegated listener and that listener share a node, where
                // stopPropagation() does not stop a sibling.
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void saveNoteEdit(openNote.id);
                }
              }}
              autoFocus
              maxLength={8000}
            />
          ) : (
            <p className="alc-popover-body">{openNote.body}</p>
          )}

          {editError ? <p className="alc-error">{editError}</p> : null}
          {deleteError ? <p className="alc-error">{deleteError}</p> : null}

          {editing ? (
            <div className="alc-actions">
              <button
                type="button"
                className="alc-btn alc-btn-ghost"
                onClick={() => {
                  setEditing(false);
                  setEditError(null);
                }}
                disabled={savingEdit}
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                className="alc-btn alc-btn-primary"
                onClick={() => saveNoteEdit(openNote.id)}
                disabled={savingEdit}
              >
                {savingEdit ? t('note.submitting') : t('note.submit')}
              </button>
            </div>
          ) : confirmDelete ? (
            <div className="alc-actions">
              <span className="alc-confirm-text">{t('deleteNote')}</span>
              <button
                type="button"
                className="alc-btn alc-btn-ghost"
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
              >
                {t('keep')}
              </button>
              <button
                type="button"
                className="alc-btn alc-btn-danger"
                onClick={() => deleteEntry({ kind: 'note', id: openNote.id })}
                disabled={deleting}
              >
                {deleting ? t('deleting') : t('delete')}
              </button>
            </div>
          ) : (
            <div className="alc-actions" style={{ justifyContent: 'space-between' }}>
              <button
                type="button"
                className="alc-btn alc-btn-text-danger"
                onClick={() => setConfirmDelete(true)}
              >
                {t('delete')}
              </button>
              <div className="alc-actions-group">
                <button
                  type="button"
                  className="alc-btn alc-btn-ghost"
                  onClick={() => {
                    setEditText(openNote.body);
                    setEditing(true);
                  }}
                >
                  {t('edit')}
                </button>
                <button
                  type="button"
                  className="alc-btn alc-btn-ghost"
                  onClick={() => setOpenTarget(null)}
                >
                  {t('close')}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
