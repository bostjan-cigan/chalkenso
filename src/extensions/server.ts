import 'server-only';

import { localServer } from '@/extensions/server.local';
import type { ServerExtensions } from '@/extensions/types';

/** What this edition adds to the shared app on the server: the local edition's answers. */
export const serverExtensions: ServerExtensions = localServer;
