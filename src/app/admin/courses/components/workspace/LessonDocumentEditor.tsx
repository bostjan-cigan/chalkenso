'use client';

import { useEffect, useId, useRef, type ReactElement } from 'react';
import { useTranslations } from 'next-intl';
import type { Editor } from '@tiptap/core';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extensions';
import { TableKit } from '@tiptap/extension-table';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Markdown } from 'tiptap-markdown';
import {
  TbArrowBackUp,
  TbArrowForwardUp,
  TbBlockquote,
  TbBold,
  TbCode,
  TbInfoSquareRounded,
  TbItalic,
  TbLink,
  TbList,
  TbSquareCheck,
  TbListNumbers,
  TbMessagePlus,
  TbPhoto,
  TbSourceCode,
  TbSparkles,
  TbTable,
} from 'react-icons/tb';
import {
  Callout,
  LessonImage,
  NoteHighlights,
  ReviewMarksExtension,
  ObsidianEmbed,
  WikiLink,
  type AssetResolver,
  type CalloutType,
} from './editor-extensions';
import AdminSearchableSelectField from '@/app/admin/components/ui/AdminSearchableSelectField';
import styles from './workspace.module.css';

export type SelectionInfo = { text: string; context: string };

type Props = {
  initialMarkdown: string;
  resolveAsset: AssetResolver;
  onReady: (editor: Editor) => void;
  onChange: () => void;
  onActivateNote: (id: string) => void;
  /** Absent on a lesson that isn't saved yet (notes need a lesson). */
  onAddNote?: (selection: SelectionInfo) => void;
  /** "Improve with AI…": the passage becomes a note and an improvement (saved lessons, for whoever works on its feedback). */
  onImproveSelection?: (selection: SelectionInfo) => void;
  /** Absent where images can't be added (a passage edited in Improve): no image button. */
  onUploadImage?: (file: File) => Promise<string | null>;
  /** While proposed changes are reviewed: the lesson is shown, not edited (no formatting toolbar). */
  readOnly?: boolean;
  /** Inside a card (a passage edited in Improve): the toolbar stays at the top of the card, not the page. */
  compact?: boolean;
};

/** The selected text and its paragraph; collapses the selection so the menu closes. */
function takeSelection(editor: Editor): SelectionInfo | null {
  const { from, to, $from } = editor.state.selection;
  const text = editor.state.doc.textBetween(from, to, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const context = $from.parent.textContent.slice(0, 1000);
  editor.commands.setTextSelection(to);
  return { text, context };
}

const BLOCK_STYLES = ['paragraph', 'h2', 'h3', 'h4'] as const;

/** The lesson as a document: write and format it like in a word processor; Markdown is stored. */
export default function LessonDocumentEditor({
  initialMarkdown,
  resolveAsset,
  onReady,
  onChange,
  onActivateNote,
  onAddNote,
  onImproveSelection,
  onUploadImage,
  readOnly = false,
  compact = false,
}: Props) {
  const textStyleId = useId();
  const t = useTranslations('editor.document');
  const tx = useTranslations('editor.extensions');
  const fileInput = useRef<HTMLInputElement>(null);
  // Callbacks change between renders; the editor is created once, so read them through refs.
  const handlers = useRef({ onChange, onActivateNote, resolveAsset });
  handlers.current = { onChange, onActivateNote, resolveAsset };

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] },
        underline: false,
        link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
      }),
      Placeholder.configure({ placeholder: t('placeholder') }),
      TableKit.configure({ table: { resizable: false } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      // Their words are taken once: a change of language reloads the page.
      WikiLink.configure({ title: (target) => tx('linkTo', { target }) }),
      ObsidianEmbed.configure({ resolve: (path) => handlers.current.resolveAsset(path), missing: (label) => tx('imageMissing', { label }) }),
      LessonImage.configure({ resolve: (path) => handlers.current.resolveAsset(path), missing: (label) => tx('imageMissing', { label }) }),
      Callout.configure({ label: (type: CalloutType) => tx(`callouts.${type}`) }),
      NoteHighlights.configure({ onActivate: (id) => handlers.current.onActivateNote(id) }),
      ReviewMarksExtension,
      Markdown.configure({ html: true, tightLists: true, bulletListMarker: '-', linkify: false, breaks: false }),
    ],
    content: initialMarkdown,
    editorProps: {
      attributes: { class: styles.prose, 'aria-label': t('label'), 'data-testid': 'lesson-document' },
    },
    onUpdate: ({ transaction }) => {
      if (transaction.docChanged) handlers.current.onChange();
    },
  });

  useEffect(() => {
    if (editor) onReady(editor);
    // onReady is stable for the workspace's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  const state = useEditorState({
    editor,
    // Tiptap's snapshot still holds no editor until the first transaction after it's created: fall
    // back to the one this render has, or the toolbar would wait for a keystroke.
    selector: ({ editor: snapshot }) => {
      const current = snapshot ?? editor;
      return current
        ? {
            block: current.isActive('heading', { level: 2 })
              ? 'h2'
              : current.isActive('heading', { level: 3 })
                ? 'h3'
                : current.isActive('heading', { level: 4 })
                  ? 'h4'
                  : 'paragraph',
            bold: current.isActive('bold'),
            italic: current.isActive('italic'),
            code: current.isActive('code'),
            bulletList: current.isActive('bulletList'),
            orderedList: current.isActive('orderedList'),
            taskList: current.isActive('taskList'),
            blockquote: current.isActive('blockquote'),
            callout: current.isActive('callout'),
            codeBlock: current.isActive('codeBlock'),
            link: current.isActive('link'),
            canUndo: current.can().undo(),
            canRedo: current.can().redo(),
          }
        : null;
    },
  });

  if (!editor || !state) {
    return <div className={styles.editorLoading}>{t('opening')}</div>;
  }

  const chain = () => editor.chain().focus();

  function setBlock(value: string) {
    if (value === 'paragraph') chain().setParagraph().run();
    else chain().setHeading({ level: Number(value.slice(1)) as 2 | 3 | 4 }).run();
  }

  function setLink() {
    const previous = editor?.getAttributes('link').href as string | undefined;
    const href = window.prompt(t('linkAddress'), previous ?? 'https://');
    if (href === null) return;
    if (!href.trim()) chain().extendMarkRange('link').unsetLink().run();
    else chain().extendMarkRange('link').setLink({ href: href.trim() }).run();
  }

  function toggleCallout() {
    if (state?.callout) chain().lift('callout').run();
    else chain().wrapIn('callout', { type: 'tip' }).run();
  }

  async function insertImage(file: File) {
    if (!onUploadImage) return;
    const sourcePath = await onUploadImage(file);
    if (sourcePath) {
      chain().insertContent({ type: 'obsidianEmbed', attrs: { target: sourcePath, size: '' } }).run();
    }
  }

  const tool = (active: boolean, label: string, onClick: () => void, icon: ReactElement, disabled = false) => (
    <button
      type="button"
      className={active ? styles.toolActive : styles.tool}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
    >
      {icon}
    </button>
  );

  return (
    <div className={styles.documentEditor}>
      <div
        className={styles.toolbar}
        role="toolbar"
        aria-label={t('formatting')}
        style={readOnly ? { display: 'none' } : compact ? { position: 'static', borderRadius: 0 } : undefined}
      >
        <AdminSearchableSelectField
          id={textStyleId}
          label={t('textStyle')}
          hideLabel
          variant="toolbar"
          searchable={false}
          value={state.block}
          options={BLOCK_STYLES.map((value) => ({ value, label: t(`blocks.${value}`) }))}
          onValueChange={setBlock}
        />
        <span className={styles.toolGroup}>
          {tool(state.bold, t('bold'), () => chain().toggleBold().run(), <TbBold size={17} />)}
          {tool(state.italic, t('italic'), () => chain().toggleItalic().run(), <TbItalic size={17} />)}
          {tool(state.code, t('code'), () => chain().toggleCode().run(), <TbCode size={17} />)}
          {tool(state.link, t('link'), setLink, <TbLink size={17} />)}
        </span>
        <span className={styles.toolGroup}>
          {tool(state.bulletList, t('bulletList'), () => chain().toggleBulletList().run(), <TbList size={17} />)}
          {tool(state.orderedList, t('orderedList'), () => chain().toggleOrderedList().run(), <TbListNumbers size={17} />)}
          {tool(state.taskList, t('taskList'), () => chain().toggleTaskList().run(), <TbSquareCheck size={17} />)}
        </span>
        <span className={styles.toolGroup}>
          {tool(state.callout, t('callout'), toggleCallout, <TbInfoSquareRounded size={17} />)}
          {tool(state.blockquote, t('quote'), () => chain().toggleBlockquote().run(), <TbBlockquote size={17} />)}
          {tool(state.codeBlock, t('codeBlock'), () => chain().toggleCodeBlock().run(), <TbSourceCode size={17} />)}
          {tool(
            false,
            t('table'),
            () => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
            <TbTable size={17} />
          )}
          {onUploadImage ? tool(false, t('image'), () => fileInput.current?.click(), <TbPhoto size={17} />) : null}
        </span>
        <span className={styles.toolGroupEnd}>
          {tool(false, t('undo'), () => chain().undo().run(), <TbArrowBackUp size={17} />, !state.canUndo)}
          {tool(false, t('redo'), () => chain().redo().run(), <TbArrowForwardUp size={17} />, !state.canRedo)}
        </span>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void insertImage(file);
          }}
        />
      </div>

      <BubbleMenu
        editor={editor}
        className={styles.bubble}
        shouldShow={({ editor: current, from, to }) =>
          from !== to && !current.isActive('codeBlock') && current.isEditable && !current.isActive('obsidianEmbed')
        }
        options={{ placement: 'top' }}
      >
        <button type="button" className={styles.bubbleTool} onClick={() => chain().toggleBold().run()} aria-label={t('bold')}>
          <TbBold size={16} />
        </button>
        <button type="button" className={styles.bubbleTool} onClick={() => chain().toggleItalic().run()} aria-label={t('italic')}>
          <TbItalic size={16} />
        </button>
        <button type="button" className={styles.bubbleTool} onClick={setLink} aria-label={t('link')}>
          <TbLink size={16} />
        </button>
        {onAddNote || onImproveSelection ? <span className={styles.bubbleDivider} /> : null}
        {onAddNote ? (
          <button
            type="button"
            className={styles.bubbleAction}
            onClick={() => {
              const info = takeSelection(editor);
              if (info) onAddNote(info);
            }}
          >
            <TbMessagePlus size={16} /> {t('addNote')}
          </button>
        ) : null}
        {onImproveSelection ? (
          <button
            type="button"
            className={styles.bubbleAction}
            onClick={() => {
              const info = takeSelection(editor);
              if (info) onImproveSelection(info);
            }}
            data-testid="improve-selection"
          >
            <TbSparkles size={16} /> {t('improveWithAi')}
          </button>
        ) : null}
      </BubbleMenu>

      <EditorContent editor={editor} className={styles.editorSurface} />
    </div>
  );
}
