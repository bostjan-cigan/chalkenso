import { copyTextToClipboard } from '@/lib/copy-to-clipboard';

/** Global classes — see `access-lesson-copy.css` (CSS Modules + imperative DOM can mismatch). */
const COPY_WRAP_CLASS = 'access-lesson-copy-wrap';
const COPY_BTN_CLASS = 'access-lesson-copy-btn';
const COPY_TOOLTIP_CLASS = 'access-lesson-copy-tooltip';

const COPY_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

/** The button's words; English unless the page passes its own (learner pages: `learner.lessons`). */
export type LessonCodeCopyLabels = { copyCode: string; copied: string };

const ENGLISH_LABELS: LessonCodeCopyLabels = { copyCode: 'Copy code', copied: 'Copied!' };

/**
 * Adds a copy button to each lesson code block inside `root`. Returns a disposer that removes the
 * buttons and their listeners. Shared by the plain lesson view and the commentable layer.
 */
export function enhanceLessonCodeCopy(root: HTMLElement, labels: LessonCodeCopyLabels = ENGLISH_LABELS): () => void {
  const disposers: Array<() => void> = [];

  root.querySelectorAll('.lesson-code-block').forEach((block) => {
    const header = block.querySelector('.lesson-code-header');
    if (!header || header.querySelector('[data-lesson-code-copy-wrap]')) {
      return;
    }

    const pre = block.querySelector('pre');
    if (!pre) {
      return;
    }

    const wrap = document.createElement('div');
    wrap.className = COPY_WRAP_CLASS;
    wrap.setAttribute('data-lesson-code-copy-wrap', '');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = COPY_BTN_CLASS;
    btn.setAttribute('aria-label', labels.copyCode);
    btn.innerHTML = COPY_ICON_SVG;

    wrap.appendChild(btn);
    header.appendChild(wrap);

    let hideTimer: ReturnType<typeof setTimeout> | undefined;

    const onClick = async () => {
      const text = pre.innerText || pre.textContent || '';
      const ok = await copyTextToClipboard(text);
      if (!ok) {
        return;
      }
      // Lets an edition's reading statistics count copied commands (a count, never the text).
      window.dispatchEvent(new CustomEvent('chalkenso:copy', { detail: { anchor: pre } }));

      wrap.querySelector('[data-lesson-code-tooltip]')?.remove();

      const tooltip = document.createElement('span');
      tooltip.className = COPY_TOOLTIP_CLASS;
      tooltip.setAttribute('data-lesson-code-tooltip', '');
      tooltip.setAttribute('role', 'status');
      tooltip.setAttribute('aria-live', 'polite');
      tooltip.textContent = labels.copied;
      wrap.insertBefore(tooltip, btn);

      if (hideTimer) {
        clearTimeout(hideTimer);
      }
      hideTimer = setTimeout(() => {
        tooltip.remove();
      }, 3000);
    };

    btn.addEventListener('click', onClick);
    disposers.push(() => {
      btn.removeEventListener('click', onClick);
      if (hideTimer) {
        clearTimeout(hideTimer);
      }
    });
  });

  return () => {
    disposers.forEach((dispose) => dispose());
    root.querySelectorAll('[data-lesson-code-copy-wrap]').forEach((node) => node.remove());
  };
}
