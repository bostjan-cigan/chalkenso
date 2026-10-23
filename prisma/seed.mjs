import { PrismaClient, UserRole } from '@prisma/client';
import { randomBytes, scryptSync } from 'node:crypto';

const prisma = new PrismaClient();

function requireEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');

  return `scrypt:${salt}:${hash}`;
}

/**
 * `--bootstrap` (for a deploy that runs it every time): creates the platform admin only when there
 * is none yet, and does nothing without ADMIN_EMAIL / ADMIN_PASSWORD, so a password changed in the
 * app is never reset by a later deploy. Without it, the first platform admin gets these details.
 */
const bootstrap = process.argv.includes('--bootstrap');

/** The password, where Better Auth keeps it (src/lib/auth.ts): the account's "credential" row. */
async function setPassword(userId, passwordHash) {
  await prisma.authAccount.deleteMany({ where: { userId, providerId: 'credential' } });
  await prisma.authAccount.create({ data: { userId, accountId: userId, providerId: 'credential', password: passwordHash } });
}

async function main() {
  if (bootstrap && !(process.env.ADMIN_EMAIL?.trim() && process.env.ADMIN_PASSWORD)) {
    console.log('Platform admin: ADMIN_EMAIL / ADMIN_PASSWORD not set, skipped.');
    return;
  }
  const identifier = requireEnv('ADMIN_EMAIL').trim();
  const password = requireEnv('ADMIN_PASSWORD');
  const passwordHash = hashPassword(password);

  const existingAdmin = await prisma.user.findFirst({
    where: {
      role: UserRole.SUPERADMIN,
    },
    orderBy: {
      createdAt: 'asc',
    },
  });

  if (existingAdmin && bootstrap) {
    console.log('Platform admin: already there, left as it is.');
    return;
  }

  // Better Auth signs in by email: an email-like identifier is the email too.
  const email = identifier.includes('@') ? identifier.toLowerCase() : null;
  const admin = existingAdmin
    ? await prisma.user.update({
        where: {
          id: existingAdmin.id,
        },
        data: {
          identifier,
          displayUsername: identifier,
          ...(email ? { email } : {}),
          isActive: true,
          banned: false,
        },
      })
    : await prisma.user.create({
        data: {
          identifier,
          displayUsername: identifier,
          email,
          name: identifier,
          role: UserRole.SUPERADMIN,
        },
      });
  await setPassword(admin.id, passwordHash);

  console.log(`Seeded admin user: ${identifier}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
