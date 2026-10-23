/** Runs once when the server starts, before it handles a request (Next's instrumentation hook). */
export async function register() {
  if (process.env.NODE_ENV === 'development' && process.env.NEXT_RUNTIME === 'nodejs' && process.env.REACT_ASYNC_DEBUG !== '1') {
    (await import('./lib/dev-react-async-hook')).skipReactAsyncDebugHook();
  }
}
