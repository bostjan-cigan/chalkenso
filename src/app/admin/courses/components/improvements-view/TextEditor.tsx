'use client';

import { useCallback, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { useTranslations } from 'next-intl';
import type { Editor } from '@tiptap/core';
import LessonDocumentEditor from '../workspace/LessonDocumentEditor';
import { roundTripKeepsText } from '../workspace/revision';
import workspace from '../workspace/workspace.module.css';
import styles from './improvements-view.module.css';

/** What the owner reads when the person is done: the text as Markdown, whichever way it was edited. */
export type TextEditorHandle = { read: () => string };

/**
 * The cursor at the end, once tiptap has finished setting the editor up. A transaction during setup
 * (tiptap's own autofocus included) can throw "Applying a mismatched transaction", which takes the
 * page down from an effect; after `isInitialized` it doesn't. Failing that, the person clicks in.
 */
function focusWhenSettled(editor: Editor, frames = 60) {
  if (editor.isDestroyed || frames <= 0) return;
  if (!editor.isInitialized) {
    requestAnimationFrame(() => focusWhenSettled(editor, frames - 1));
    return;
  }
  try {
    editor.commands.focus('end');
  } catch {
    // Left unfocused.
  }
}

/** The editor's document as Markdown (tiptap-markdown keeps its serializer in editor storage). */
const readMarkdown = (editor: Editor) => (editor.storage as unknown as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown();

/**
 * A passage edited in Improve (a suggestion rewritten, a section by hand): the lesson editor's own
 * visual editor, or its Markdown, switched like in Edit mode. Text the visual editor can't keep
 * (raw HTML, footnotes…) opens in Markdown.
 */
export default function TextEditor({
  initial,
  assets,
  label,
  ref,
}: {
  initial: string;
  assets: Map<string, string>;
  label: string;
  ref: Ref<TextEditorHandle>;
}) {
  const t = useTranslations('editor.workspace');
  const [mode, setMode] = useState<'visual' | 'markdown'>('visual');
  const [markdown, setMarkdown] = useState(initial);
  const editorRef = useRef<Editor | null>(null);
  const changed = useRef(false);

  const read = useCallback(() => {
    const editor = editorRef.current;
    if (mode === 'visual' && editor && changed.current) return readMarkdown(editor);
    return markdown;
  }, [mode, markdown]);
  useImperativeHandle(ref, () => ({ read }), [read]);

  const switchTo = (next: 'visual' | 'markdown') => {
    if (next === mode) return;
    const editor = editorRef.current;
    if (next === 'markdown') {
      if (editor && changed.current) setMarkdown(readMarkdown(editor));
    } else if (editor) {
      editor.commands.setContent(markdown);
    }
    changed.current = false;
    setMode(next);
  };

  return (
    <div className={styles.textEditor}>
      <div className={styles.textEditorBar}>
        <div className={workspace.segmented} role="group" aria-label={t('editorMode')}>
          <button type="button" aria-pressed={mode === 'visual'} className={mode === 'visual' ? workspace.segmentActive : workspace.segment} onClick={() => switchTo('visual')}>
            {t('visual')}
          </button>
          <button type="button" aria-pressed={mode === 'markdown'} className={mode === 'markdown' ? workspace.segmentActive : workspace.segment} onClick={() => switchTo('markdown')}>
            {t('markdown')}
          </button>
        </div>
      </div>
      <div hidden={mode !== 'visual'} className={styles.textEditorVisual}>
        <LessonDocumentEditor
          initialMarkdown={initial}
          resolveAsset={(path) => assets.get(path) ?? assets.get(path.split('/').pop() ?? path) ?? null}
          onReady={(editor) => {
            editorRef.current = editor;
            if (initial.trim() && !roundTripKeepsText(initial, readMarkdown(editor))) setMode('markdown');
            else focusWhenSettled(editor);
          }}
          onChange={() => {
            changed.current = true;
          }}
          onActivateNote={() => undefined}
          compact
        />
      </div>
      {mode === 'markdown' ? (
        <textarea
          className={styles.textEditorMarkdown}
          value={markdown}
          onChange={(event) => setMarkdown(event.target.value)}
          aria-label={label}
          rows={Math.min(18, Math.max(6, markdown.split('\n').length + Math.ceil(markdown.length / 70)))}
          spellCheck={false}
          autoFocus
        />
      ) : null}
    </div>
  );
}
