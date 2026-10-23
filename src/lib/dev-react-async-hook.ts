import type { AsyncHook, HookCallbacks } from 'node:async_hooks';

/**
 * `next dev` only (src/instrumentation.ts calls it before the first page renders).
 *
 * React's server renderer, inside Next's app-page runtime, records every async operation of a render
 * with an async hook, for the debug info React DevTools shows, in a map that only the operation's
 * `destroy` empties. An entry whose promise stays reachable from its own component's props never gets
 * one, so it keeps that render's route tree, and with it the copy of the page's compiled code that
 * rendered it (`next dev` loads a fresh copy after every compile). Over a `yarn test:e2e` run that was
 * several GB, enough for Next to restart the dev server mid-suite. Without the hook React just leaves
 * that debug info out. `REACT_ASYNC_DEBUG=1` keeps it.
 */
export function skipReactAsyncDebugHook() {
  // `process.getBuiltinModule` (not an import): the module object itself, which React's runtime gets too.
  // (Node ≥ 20.16; the installed @types/node predates it.)
  const asyncHooks = (
    process as unknown as { getBuiltinModule: (id: 'node:async_hooks') => { createHook: (callbacks: HookCallbacks) => AsyncHook } }
  ).getBuiltinModule('node:async_hooks');
  const createHook = asyncHooks.createHook;
  asyncHooks.createHook = (callbacks) => {
    // React creates its hook while Next's app-page runtime loads.
    if (/next-server[\\/]app-page[^\\/]*\.runtime\.dev\.js|react-server-dom-[a-z-]+-server\.node\.development\.js/.test(new Error().stack ?? '')) {
      const off: AsyncHook = { enable: () => off, disable: () => off };
      return off;
    }
    return createHook(callbacks);
  };
}
