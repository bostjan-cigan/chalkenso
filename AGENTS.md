<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## UI conventions

- Dropdowns: always the product's own (`Dropdown` in `src/components/Dropdown.tsx`, or
  `AdminSearchableSelectField` with `onValueChange`), never a native `<select>`. ESLint enforces it.

## Access

- Every page, API route and server action that touches course data checks access with the helpers in
  `src/lib/crm-access.ts` (`requireCourseAccess`, `requireGroupAccess`, `requireVersionEdit`,
  `canWorkOnFeedback`, the `*ScopeWhere` list filters). `requireMember()` alone is never enough.
- Every export from a `'use server'` file is a public endpoint: it checks access itself.
- Access is per organisation: only the active organisation's membership and grant rows ever count.
