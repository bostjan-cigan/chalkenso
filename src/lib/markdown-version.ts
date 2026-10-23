/**
 * Bump when the course markdown pipeline output changes, so cached lesson HTML
 * (keyed by `computeLessonSourceHash`) is re-rendered.
 *
 * Kept in its own module so code that only needs the version — the hash, the render cache check —
 * doesn't pull in the whole `unified`/`remark`/`rehype` pipeline to read one string.
 */
export const COURSE_MARKDOWN_RENDER_VERSION = '6';
