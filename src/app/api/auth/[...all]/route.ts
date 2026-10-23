import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** Better Auth's endpoints (/api/auth/...): signing in, the two-factor step, and what its client asks. */
export const { GET, POST } = toNextJsHandler(auth);
