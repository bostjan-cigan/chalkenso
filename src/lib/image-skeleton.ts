/**
 * Marks images in pre-rendered HTML (`dangerouslySetInnerHTML`) with `data-loaded` once they have
 * loaded or failed, so CSS can show a skeleton until then (`img:not([data-loaded])` in
 * markdown-content.module.css). Images that finished before hydration are marked right away.
 * Returns a disposer for `useEffect`.
 */
export function trackImageLoading(root: HTMLElement): () => void {
  const disposers: Array<() => void> = [];

  root.querySelectorAll('img').forEach((img) => {
    const markLoaded = () => img.setAttribute('data-loaded', '');
    if (img.complete) {
      markLoaded();
      return;
    }
    img.addEventListener('load', markLoaded, { once: true });
    img.addEventListener('error', markLoaded, { once: true });
    disposers.push(() => {
      img.removeEventListener('load', markLoaded);
      img.removeEventListener('error', markLoaded);
    });
  });

  return () => disposers.forEach((dispose) => dispose());
}
