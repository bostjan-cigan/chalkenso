'use client';

import { createAuthClient } from 'better-auth/react';
import { twoFactorClient, usernameClient } from 'better-auth/client/plugins';

/**
 * Better Auth in the browser: the sign-in form and its two-factor step talk to its endpoints
 * (/api/auth), so its limits per address apply to them.
 */
export const authClient = createAuthClient({
  basePath: '/api/auth',
  plugins: [usernameClient(), twoFactorClient()],
});
