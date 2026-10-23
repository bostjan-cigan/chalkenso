'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import type { Editor } from '@tiptap/core';
import { TbAlertTriangle, TbChevronRight, TbCircleCheck, TbEye } from 'react-icons/tb';
import { getPendingImageReferences } from '@/lib/course-markdown';
import { createSlugCandidate } from '@/lib/slugs';
import { INTL_LOCALES, type Locale } from '@/i18n/config';
import { createLessonInlineAction, updateLessonInlineAction } from '../../actions';
import type { UploadedLessonAsset } from '../../types';
import LessonAssetUploadList from '../LessonAssetUploadList';
import LessonModeSwitch from '../LessonModeSwitch';
import { ASSETS_UPDATED_EVENT } from './editor-extensions';
import LessonDocumentEditor, { type SelectionInfo } from './LessonDocumentEditor';
import SelectionComposer from './SelectionComposer';
import { announceSaved } from './events';
import { roundTripKeepsText } from './revision';
import AdminSearchableSelectField from '@/app/admin/components/ui/AdminSearchableSelectField';
import styles from './workspace.module.css';

type LessonStatus = 'DRAFT' | 'PUBLISHED';

type Saved = {
  title: string;
  slug: string;
  shortDescription: string;
  status: LessonStatus;
  arcId: string;
  markdown: string;
};

export type LessonWorkspaceProps = {
  courseId: string;
  courseTitle: string;
  /** The course's page, when the viewer can open it (a group's instructor may not): else plain text. */
  courseHref?: string | null;
  /**
   * Whose lessons these are: the course's own (new groups start from them), or one group's copy
   * (only that group reads it). Shown as a strip under the toolbar.
   */
  level?: { kind: 'course' } | { kind: 'copy'; groupName: string; groupHref: string | null };
  curriculumVersionId?: string;
  /** "v2", or the group's name for a group's copy. */
  versionLabel: string;
  backHref: string;
  previewHref?: string;
  lessonId?: string;
  position?: number;
  /** The lesson's revision when the page loaded: a save is refused if it changed meanwhile. */
  revision?: number;
  initial: Saved;
  publishedAt?: string | null;
  hasUnpublishedChanges?: boolean;
  arcs: { id: string; title: string }[];
  initialUploadedAssets: Record<string, UploadedLessonAsset>;
  /** The lesson's Improve mode (for whoever works on its feedback), and how much waits there. */
  improveHref?: string | null;
  improveCount?: number;
  /** Notes on selected text (saved lessons, for whoever may note it). */
  canNote?: boolean;
};

const MODE_KEY = 'lesson-editor-mode';

/** The editor's document as Markdown (tiptap-markdown keeps its serializer in editor storage). */
function readMarkdown(editor: Editor) {
  return (editor.storage as unknown as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown();
}

/**
 * A lesson's Edit mode: the lesson as a document, its details beside it, and Save. Nothing else: no
 * AI, no feedback. Improving it (feedback, plans with AI, proposed changes) is its Improve mode; the
 * one way there from the text is selecting a passage, which can become a note or an improvement.
 * Lessons are stored as Markdown (for Obsidian and the learner pages); people edit them visually,
 * and developers can switch to Markdown.
 */
export default function LessonWorkspace(props: LessonWorkspaceProps) {
  const { courseId, curriculumVersionId, lessonId, initial } = props;
  const t = useTranslations('editor.workspace');
  const locale = useLocale() as Locale;
  const router = useRouter();
  const editorRef = useRef<Editor | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // --- Lesson fields -----------------------------------------------------------------------------
  const [saved, setSaved] = useState<Saved>(initial);
  // The revision this editor's text is based on: each save sends it and gets the next one back.
  const [revision, setRevision] = useState(props.revision);
  const [title, setTitle] = useState(initial.title);
  const [slug, setSlug] = useState(initial.slug);
  const [slugTouched, setSlugTouched] = useState(Boolean(lessonId));
  const [shortDescription, setShortDescription] = useState(initial.shortDescription);
  const [status, setStatus] = useState<LessonStatus>(initial.status);
  const [arcId, setArcId] = useState(initial.arcId);

  // --- Text: Markdown is the source of truth; the visual editor writes into it -------------------
  const [mode, setMode] = useState<'visual' | 'markdown'>('visual');
  const [markdown, setMarkdownState] = useState(initial.markdown);
  const markdownRef = useRef(initial.markdown);
  const [visualPending, setVisualPending] = useState(false);
  const visualPendingRef = useRef(false);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [fidelityWarning, setFidelityWarning] = useState(false);

  const setMarkdown = useCallback((value: string) => {
    markdownRef.current = value;
    setMarkdownState(value);
  }, []);

  /** Writes the visual editor's pending changes into the Markdown and returns it. */
  const flushVisual = useCallback(() => {
    if (flushTimer.current) clearTimeout(flushTimer.current);
    const editor = editorRef.current;
    if (visualPendingRef.current && editor) {
      const next = readMarkdown(editor);
      visualPendingRef.current = false;
      setVisualPending(false);
      setMarkdown(next);
      return next;
    }
    return markdownRef.current;
  }, [setMarkdown]);

  const handleVisualChange = useCallback(() => {
    visualPendingRef.current = true;
    setVisualPending(true);
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(flushVisual, 400);
  }, [flushVisual]);

  function switchMode(next: 'visual' | 'markdown') {
    if (next === mode) return;
    if (next === 'markdown') {
      flushVisual();
    } else {
      editorRef.current?.commands.setContent(markdownRef.current);
      visualPendingRef.current = false;
      setVisualPending(false);
      setFidelityWarning(false);
    }
    setMode(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {}
  }

  useEffect(() => {
    try {
      if (localStorage.getItem(MODE_KEY) === 'markdown') setMode('markdown');
    } catch {}
  }, []);

  // --- Images ------------------------------------------------------------------------------------
  const [uploadedAssets, setUploadedAssets] = useState(props.initialUploadedAssets);
  const assetUrls = useMemo(() => {
    const map = new Map<string, string>();
    for (const asset of Object.values(uploadedAssets)) {
      if (asset?.publicUrl) map.set(asset.sourcePath, asset.publicUrl);
    }
    return map;
  }, [uploadedAssets]);
  const assetUrlsRef = useRef(assetUrls);
  assetUrlsRef.current = assetUrls;
  const resolveAsset = useCallback((path: string) => {
    const map = assetUrlsRef.current;
    return map.get(path) ?? map.get(path.split('/').pop() ?? path) ?? null;
  }, []);

  function addUploadedAsset(asset: UploadedLessonAsset) {
    setUploadedAssets((current) => ({ ...current, [asset.sourcePath]: asset }));
    assetUrlsRef.current = new Map(assetUrlsRef.current).set(asset.sourcePath, asset.publicUrl ?? '');
    window.dispatchEvent(new Event(ASSETS_UPDATED_EVENT));
  }

  async function uploadImage(file: File): Promise<string | null> {
    const base = file.name.replace(/[^\w.\-]+/g, '-');
    let sourcePath = base;
    for (let n = 2; uploadedAssets[sourcePath]; n += 1) sourcePath = base.replace(/(\.\w+)?$/, `-${n}$1`);
    const body = new FormData();
    body.set('file', file);
    body.set('sourcePath', sourcePath);
    body.set('courseId', courseId);
    try {
      const response = await fetch('/admin/api/assets/upload', { method: 'POST', body });
      const payload = (await response.json()) as { asset?: UploadedLessonAsset; error?: string };
      if (!response.ok || !payload.asset) throw new Error(payload.error || t('uploadFailed'));
      addUploadedAsset(payload.asset);
      return sourcePath;
    } catch (error) {
      setFlash({ tone: 'error', message: error instanceof Error ? error.message : t('uploadFailed') });
      return null;
    }
  }

  const pendingImages = getPendingImageReferences(markdown);
  const missingImages = pendingImages.filter((reference) => !uploadedAssets[reference.sourcePath]);

  // --- Save ----------------------------------------------------------------------------------------
  const [flash, setFlash] = useState<{ tone: 'error' | 'success'; message: string } | null>(null);
  const [saving, startSaving] = useTransition();

  const unsaved =
    visualPending ||
    markdown !== saved.markdown ||
    title !== saved.title ||
    slug !== saved.slug ||
    shortDescription !== saved.shortDescription ||
    status !== saved.status ||
    arcId !== saved.arcId;

  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);

  /** Saves the lesson as it is in the editor; true when it saved. */
  async function saveNow(): Promise<boolean> {
    const form = formRef.current;
    if (!form) return false;
    if (!form.reportValidity()) return false;
    const content = mode === 'visual' ? flushVisual() : markdownRef.current;
    const formData = new FormData(form);
    formData.set('markdownContent', content);
    formData.delete('uploadedAssetBinding');
    for (const reference of getPendingImageReferences(content)) {
      const asset = uploadedAssets[reference.sourcePath];
      if (asset) {
        formData.append('uploadedAssetBinding', JSON.stringify({ assetId: asset.assetId, sourcePath: asset.sourcePath }));
      }
    }
    const snapshot: Saved = { title, slug, shortDescription, status, arcId, markdown: content };
    const action = lessonId ? updateLessonInlineAction : createLessonInlineAction;
    const result = await action(formData);
    if (!result.ok) {
      setFlash({ tone: 'error', message: result.message });
      return false;
    }
    setSaved(snapshot);
    if (result.revision) setRevision(result.revision);
    if (lessonId) announceSaved('lesson', lessonId);
    setFlash(null);
    if (result.redirectTo) {
      router.replace(result.redirectTo);
      return true;
    }
    router.refresh();
    return true;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startSaving(async () => void (await saveNow()));
  }

  // --- A passage selected: a note, or an improvement ---------------------------------------------
  const [composer, setComposer] = useState<{ selection: SelectionInfo; improve: boolean } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const openComposer = (selection: SelectionInfo, improve: boolean) => {
    // An improvement is planned on the saved lesson: unsaved edits are saved first.
    if (unsaved) {
      setFlash({ tone: 'error', message: t('saveBeforeNote') });
      return;
    }
    setComposer({ selection, improve });
  };

  // --- Editor lifecycle ----------------------------------------------------------------------------
  const handleReady = useCallback((editor: Editor) => {
    editorRef.current = editor;
    // Lessons using Markdown the visual editor can't keep (raw HTML, footnotes…) open in Markdown.
    const original = markdownRef.current;
    if (original.trim() && !roundTripKeepsText(original, readMarkdown(editor))) {
      setFidelityWarning(true);
      setMode('markdown');
    }
  }, []);

  const groupHref = props.level?.kind === 'copy' ? props.level.groupHref : null;
  const crumbs = (
    <nav className={styles.crumbs} aria-label={t('breadcrumb')}>
      {props.courseHref === null ? (
        <span className={styles.crumbPlain}>{props.courseTitle}</span>
      ) : (
        <Link href={props.courseHref ?? `/admin/courses/${courseId}`}>{props.courseTitle}</Link>
      )}
      <TbChevronRight size={14} aria-hidden />
      <Link href={props.backHref}>{props.versionLabel}</Link>
      <TbChevronRight size={14} aria-hidden />
      <span>{lessonId ? t('lessonCrumb', { position: props.position ?? '' }) : t('newLesson')}</span>
    </nav>
  );

  return (
    <form ref={formRef} id="lesson-editor" className={styles.workspace} onSubmit={handleSubmit}>
      <input type="hidden" name="courseId" value={courseId} />
      {curriculumVersionId ? <input type="hidden" name="curriculumVersionId" value={curriculumVersionId} /> : null}
      {lessonId ? <input type="hidden" name="lessonId" value={lessonId} /> : null}
      {lessonId && revision ? <input type="hidden" name="revision" value={revision} /> : null}
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="shortDescription" value={shortDescription} />
      <input type="hidden" name="status" value={status} />
      <input type="hidden" name="arcId" value={arcId} />

      <header className={styles.topBar}>
        {crumbs}
        <div className={styles.topActions}>
          <span className={unsaved ? styles.saveStateDirty : styles.saveState} aria-live="polite">
            {saving ? t('saving') : unsaved ? t('unsaved') : lessonId ? t('allSaved') : t('notSavedYet')}
            {notice ? <span className={styles.aiNotice}>{` · ${notice}`}</span> : null}
          </span>
          {lessonId ? (
            <LessonModeSwitch
              mode="edit"
              editHref="#"
              improveHref={props.improveHref ?? null}
              improveCount={props.improveCount ?? 0}
              unsaved={unsaved}
              onSave={saveNow}
            />
          ) : null}
          <div className={styles.segmented} role="group" aria-label={t('editorMode')}>
            <button type="button" className={mode === 'visual' ? styles.segmentActive : styles.segment} onClick={() => switchMode('visual')}>
              {t('visual')}
            </button>
            <button type="button" className={mode === 'markdown' ? styles.segmentActive : styles.segment} onClick={() => switchMode('markdown')} title={t('markdownTitle')}>
              {t('markdown')}
            </button>
          </div>
          {props.previewHref ? (
            <Link href={props.previewHref} className={styles.ghostButton}>
              <TbEye size={16} aria-hidden /> {t('preview')}
            </Link>
          ) : null}
          <AdminSearchableSelectField
            id="lesson-status"
            label={t('status')}
            hideLabel
            variant="toolbar"
            triggerClassName={styles.statusSelect}
            searchable={false}
            value={status}
            options={[
              { value: 'DRAFT', label: t('statuses.draft') },
              { value: 'PUBLISHED', label: t('statuses.published') },
            ]}
            onValueChange={(next) => setStatus(next === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT')}
          />
          {/* Filled only when there is something to save: then it is the one obvious action. */}
          <button type="submit" className={unsaved || !lessonId ? styles.primaryButton : styles.ghostButton} disabled={saving}>
            {saving ? t('saving') : lessonId ? t('save') : t('createLesson')}
          </button>
        </div>
      </header>

      {flash ? (
        <div className={flash.tone === 'error' ? styles.flashError : styles.flashSuccess} role="status">
          {flash.tone === 'error' ? <TbAlertTriangle size={18} aria-hidden /> : <TbCircleCheck size={18} aria-hidden />}
          {flash.message}
          <button type="button" onClick={() => setFlash(null)} aria-label={t('dismiss')}>
            ×
          </button>
        </div>
      ) : null}

      {props.level ? (
        <p className={props.level.kind === 'copy' ? `${styles.levelStrip} ${styles.levelStripCopy}` : styles.levelStrip} data-testid="lesson-level">
          {props.level.kind === 'copy' ? (
            <>
              <strong>
                {t.rich('copyTitle', {
                  name: props.level.groupName,
                  group: (chunks) => (groupHref ? <Link href={groupHref}>{chunks}</Link> : chunks),
                })}
              </strong>
              <span>{t('copyText')}</span>
            </>
          ) : (
            <>
              <strong>{t('courseTitle')}</strong>
              <span>{t('courseText')}</span>
            </>
          )}
        </p>
      ) : null}

      <div className={styles.titleRow}>
        <input
          id="lesson-title"
          name="title"
          className={styles.titleInput}
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
            if (!slugTouched) setSlug(createSlugCandidate(event.target.value, ''));
          }}
          placeholder={t('titlePlaceholder')}
          required
          autoComplete="off"
        />
        <p className={styles.statusLine}>
          {status === 'PUBLISHED'
            ? t('statusPublished')
            : props.publishedAt
              ? t(props.hasUnpublishedChanges ? 'statusDraftKeepsUnpublished' : 'statusDraftKeeps', {
                  date: new Date(props.publishedAt).toLocaleDateString(INTL_LOCALES[locale]),
                })
              : t('statusDraftHidden')}
        </p>
      </div>

      <div className={styles.grid}>
        <div className={styles.documentColumn}>
          <div className={styles.paper}>
            <div hidden={mode !== 'visual'}>
              <LessonDocumentEditor
                initialMarkdown={initial.markdown}
                resolveAsset={resolveAsset}
                onReady={handleReady}
                onChange={handleVisualChange}
                onActivateNote={() => undefined}
                onAddNote={lessonId && props.canNote ? (selection) => openComposer(selection, false) : undefined}
                onImproveSelection={lessonId && props.improveHref ? (selection) => openComposer(selection, true) : undefined}
                onUploadImage={uploadImage}
              />
            </div>

            <div hidden={mode !== 'markdown'} className={styles.markdownPane}>
              {fidelityWarning ? (
                <p className={styles.fidelityNote}>
                  <TbAlertTriangle size={16} aria-hidden /> {t('fidelity')}
                </p>
              ) : null}
              <textarea
                id="lesson-markdown"
                className={styles.markdownInput}
                value={markdown}
                onChange={(event) => setMarkdown(event.target.value)}
                spellCheck={false}
                placeholder={t('markdownPlaceholder')}
                aria-label={t('markdownLabel')}
              />
              <p className={styles.markdownHint}>{t('markdownHint')}</p>
            </div>
          </div>

          {missingImages.length ? (
            <div className={styles.imagesCard}>
              <h3>{t('imagesTitle')}</h3>
              <p>{t('imagesText')}</p>
              <LessonAssetUploadList courseId={courseId} onAssetUploaded={addUploadedAsset} references={missingImages} uploadedAssets={uploadedAssets} />
            </div>
          ) : null}
        </div>

        <aside className={styles.side} aria-label={t('detailsTab')}>
          <h2 className={styles.sideTitle}>{t('detailsTab')}</h2>
          <div className={styles.details}>
            <label className={styles.detailField}>
              <span>{t('shortDescription')}</span>
              <input
                value={shortDescription}
                maxLength={160}
                onChange={(event) => setShortDescription(event.target.value)}
                placeholder={t('shortDescriptionPlaceholder')}
                id="lesson-short-description"
              />
            </label>
            {props.arcs.length ? (
              <AdminSearchableSelectField
                id="lesson-arc"
                label={t('section')}
                className={styles.detailField}
                labelClassName=""
                searchable={props.arcs.length > 8}
                value={arcId}
                options={[{ value: '', label: t('noSection') }, ...props.arcs.map((arc) => ({ value: arc.id, label: arc.title }))]}
                onValueChange={setArcId}
              />
            ) : null}
            <label className={styles.detailField}>
              <span>{t('slug')}</span>
              <input
                value={slug}
                onChange={(event) => {
                  setSlugTouched(true);
                  setSlug(createSlugCandidate(event.target.value, ''));
                }}
                placeholder={t('slugPlaceholder')}
                id="lesson-slug"
              />
              <small>{t('slugHint')}</small>
            </label>
          </div>
        </aside>
      </div>

      {composer && lessonId ? (
        <SelectionComposer
          lessonId={lessonId}
          selection={composer.selection}
          improve={composer.improve}
          onClose={() => setComposer(null)}
          onNoted={() => {
            setComposer(null);
            setNotice(t('noteSaved'));
            router.refresh();
          }}
          onImprovement={(taskId) => {
            setComposer(null);
            router.push(`${props.improveHref}?i=${taskId}`);
          }}
        />
      ) : null}
    </form>
  );
}
