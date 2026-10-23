// Demo data for installs and tests: the Northwind Academy organisation with five courses, groups,
// learners, feedback, instructor notes and tasks (src/lib/demo).
//
//   yarn db:seed-demo            (reads DEMO_EMAIL / DEMO_PASSWORD from .env.local)
//
// Idempotent: re-running replaces the demo organisation and its data. Never touches other data.
// The local edition runs one organisation, so there the demo needs an installation without another.
import { PrismaClient } from '@prisma/client';
import { randomBytes, scryptSync } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import nextEnv from '@next/env';
import { build } from 'esbuild';

nextEnv.loadEnvConfig(process.cwd());
const prisma = new PrismaClient();
// The edition, decided as next.config.js does: cloud when the cloud code is there, unless told local.
const LOCAL = !existsSync(join(process.cwd(), 'src', 'cloud')) || process.env.NEXT_PUBLIC_EDITION === 'local';

const ORG_SLUG = 'northwind-academy';

/** The app's demo service (TypeScript), compiled for this script. */
async function loadDemoService() {
  const entry = fileURLToPath(new URL('../src/lib/demo/demo-organization.ts', import.meta.url));
  const out = await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', write: false, packages: 'external' });
  return import(`data:text/javascript,${encodeURIComponent(out.outputFiles[0].text)}`);
}

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt:${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

async function main() {
  const email = (process.env.DEMO_EMAIL || 'demo@example.com').trim().toLowerCase();
  const password = process.env.DEMO_PASSWORD;
  if (!password || password.length < 8) {
    throw new Error('Set DEMO_PASSWORD (8+ characters) in .env.local first.');
  }

  if (LOCAL) {
    const other = await prisma.organization.findFirst({ where: { slug: { not: ORG_SLUG } }, select: { name: true } });
    if (other) {
      throw new Error(
        `This installation already has its organisation ("${other.name}"), and the local edition runs one. ` +
          'The demo needs an empty installation: reset the database first.'
      );
    }
  }

  await prisma.organization.deleteMany({ where: { slug: ORG_SLUG } });

  const passwordHash = hashPassword(password);
  const owner = await prisma.user.upsert({
    where: { identifier: email },
    update: { isActive: true, banned: false },
    create: { identifier: email, displayUsername: email, email, name: 'Maja Kovač', firstName: 'Maja', lastName: 'Kovač' },
  });
  // The password, where Better Auth keeps it (src/lib/auth.ts): the account's "credential" row.
  const setPassword = async (userId, hash) => {
    await prisma.authAccount.deleteMany({ where: { userId, providerId: 'credential' } });
    await prisma.authAccount.create({ data: { userId, accountId: userId, providerId: 'credential', password: hash } });
  };
  await setPassword(owner.id, passwordHash);
  // A reset demo owner belongs to Northwind only, so signing in always lands there (the switch test
  // adds them to other organisations, and sign-in picks the oldest membership).
  await prisma.organizationMember.deleteMany({ where: { userId: owner.id } });
  const instructor = await prisma.user.upsert({
    where: { identifier: 'ana.novak@example.com' },
    update: {},
    create: {
      identifier: 'ana.novak@example.com',
      displayUsername: 'ana.novak@example.com',
      email: 'ana.novak@example.com',
      name: 'Ana Novak',
      firstName: 'Ana',
      lastName: 'Novak',
    },
  });
  if (!(await prisma.authAccount.count({ where: { userId: instructor.id, providerId: 'credential' } }))) {
    await setPassword(instructor.id, hashPassword(randomBytes(16).toString('hex')));
  }

  const { DemoOrganization } = await loadDemoService();
  await prisma.$transaction(
    async (tx) => {
      const org = await tx.organization.create({
        data: {
          name: 'Northwind Academy',
          slug: ORG_SLUG,
          // Team: room for the demo's people and classes (the local edition is never limited).
          plan: LOCAL ? 'LOCAL' : 'TEAM',
          isDemo: true,
          members: {
            create: [
              { userId: owner.id, role: 'OWNER' },
              // Ana teaches the evening group only (her access is set once the group exists).
              { userId: instructor.id, role: 'MEMBER', access: 'LIMITED' },
            ],
          },
        },
      });
      const demo = await new DemoOrganization(tx, org.id, owner, { instructor }).build();
      await tx.userGrant.create({
        data: {
          userId: instructor.id,
          organizationId: org.id,
          entityType: 'group',
          entityId: demo.eveningGroupId,
          permissions: ['READ', 'WRITE', 'DELETE', 'TASKS'],
          createdById: owner.id,
        },
      });
    },
    { timeout: 180000 }
  );

  console.log(`Demo organisation "Northwind Academy" ready. Sign in as ${email} (password: DEMO_PASSWORD in .env.local).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
