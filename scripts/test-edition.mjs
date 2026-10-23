// Tests one edition from scratch: a fresh database in the docker-compose Postgres, migrations, a
// production build, the server, and the end-to-end suites in the order that edition needs.
//
//   node scripts/test-edition.mjs local    first sign-up sets up the installation, then the demo
//
// Options: --port 3102 (default), --database <name>, --dev (next dev instead of build + start; stop `yarn dev` first,
// Next runs one dev server per folder), --keep-db (leave the test database for a look afterwards).
// Settings come from .env.local and the environment (CI); the database is
// <POSTGRES_DB>_e2e_<edition>, so your own data is never touched.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const editions = ['local'];
const edition = args.find((arg) => editions.includes(arg));
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};
const flag = (name) => args.includes(`--${name}`);
if (!edition) {
  console.error(`Usage: node scripts/test-edition.mjs ${editions.join('|')} [--port 3102] [--database name] [--dev] [--keep-db]`);
  process.exit(2);
}

const fileEnv = existsSync('.env.local')
  ? Object.fromEntries(
      readFileSync('.env.local', 'utf8')
        .split('\n')
        .filter((line) => /^[A-Z_]+=/.test(line))
        .map((line) => [line.split('=')[0], line.slice(line.indexOf('=') + 1).replace(/^"|"$/g, '')])
    )
  : {};
const baseEnv = { ...fileEnv, ...process.env };
for (const name of ['DATABASE_URL', 'ADMIN_EMAIL', 'ADMIN_PASSWORD', 'DEMO_EMAIL', 'DEMO_PASSWORD']) {
  if (!baseEnv[name]) {
    console.error(`Set ${name} (in .env.local or the environment).`);
    process.exit(2);
  }
}

const port = Number(option('port', '3102'));
const base = `http://localhost:${port}`;
const container = baseEnv.E2E_PG_CONTAINER || 'curriculum-ai-postgres';
const pgUser = baseEnv.POSTGRES_USER || 'postgres';
const database = option('database', `${baseEnv.POSTGRES_DB || 'curriculum_ai'}_e2e_${edition}`);
if (!/^[a-z0-9_]+$/.test(database)) {
  console.error(`Not a usable database name: ${database}`);
  process.exit(2);
}
const databaseUrl = (() => {
  const url = new URL(baseEnv.DATABASE_URL);
  url.pathname = `/${database}`;
  return url.toString();
})();

const env = (extra = {}) => ({
  ...baseEnv,
  DATABASE_URL: databaseUrl,
  DATABASE_URL_UNPOOLED: databaseUrl,
  E2E_DB: database,
  BASE_URL: base,
  NEXT_PUBLIC_APP_URL: base,
  AI_MOCK: '1',
  // Email goes to Mailpit (started below), never anywhere real (SMTP_HOST wins over Resend anyway).
  RESEND_API_KEY: '',
  SMTP_HOST: 'localhost',
  SMTP_PORT: baseEnv.MAILPIT_SMTP_PORT || '1025',
  MAILPIT_URL: `http://localhost:${baseEnv.MAILPIT_UI_PORT || '8025'}`,
  // A run signs in hundreds of times from 127.0.0.1: Better Auth's limits per address skip this machine.
  AUTH_LIMITS_SKIP_LOOPBACK: '1',
  NEXT_TELEMETRY_DISABLED: '1',
  NEXT_PUBLIC_EDITION: edition,
  ...extra,
});

function step(title) {
  console.log(`\n▸ ${title}`);
}

function run(command, commandArgs, extra = {}) {
  const result = spawnSync(command, commandArgs, { stdio: 'inherit', env: env(extra) });
  if (result.status !== 0) {
    throw new Error(`${command} ${commandArgs.join(' ')} exited with ${result.status}`);
  }
}

function psql(query) {
  run('docker', ['exec', container, 'psql', '-q', '-U', pgUser, '-d', 'postgres', '-c', query]);
}

let server = null;

/** Starts the app (building it first, unless `build: false` restarts the build already made). */
async function startServer(extra, { build = true } = {}) {
  if (flag('dev')) {
    spawnSync('rm', ['-rf', '.next/dev']);
    server = spawn('npx', ['next', 'dev', '-p', String(port)], { env: env(extra), stdio: ['ignore', 'pipe', 'pipe'] });
  } else {
    if (build) {
      step(`Build (${[edition, ...Object.entries(extra).map(([name, value]) => `${name}=${value}`)].join(', ')})`);
      run('npx', ['next', 'build'], extra);
    }
    server = spawn('npx', ['next', 'start', '-p', String(port)], { env: env(extra), stdio: ['ignore', 'pipe', 'pipe'] });
  }
  let log = '';
  server.stdout.on('data', (chunk) => (log += chunk));
  server.stderr.on('data', (chunk) => (log += chunk));
  for (let attempt = 0; attempt < 240; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`The server stopped:\n${log.slice(-2000)}`);
    }
    const ready = await fetch(`${base}/admin/login`).then((response) => response.ok, () => false);
    if (ready) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`The server didn't answer on ${base}:\n${log.slice(-2000)}`);
}

async function stopServer() {
  if (server && server.exitCode === null) {
    const stopped = new Promise((resolve) => server.once('exit', resolve));
    server.kill('SIGTERM');
    await Promise.race([stopped, new Promise((resolve) => setTimeout(resolve, 5000))]);
  }
  server = null;
}

function suites(list, extra = {}) {
  const result = spawnSync(process.execPath, ['tests/e2e/run.mjs', ...list], { stdio: 'inherit', env: env(extra) });
  return result.status === 0;
}

const outcomes = [];
try {
  step('Mailpit for the emails the tests read');
  run('docker', ['compose', ...(existsSync('.env.local') ? ['--env-file', '.env.local'] : []), 'up', '-d', 'mailpit']);
  step(`Fresh database ${database}`);
  psql(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
  psql(`CREATE DATABASE ${database}`);
  run('npx', ['prisma', 'migrate', 'deploy']);

  if (edition === 'local') {
    await startServer({});
    step('A fresh installation: the first sign-up owns it');
    outcomes.push(['local: set-up and core app', suites(['e2e.mjs'])]);
    // The local edition runs one organisation: the demo needs an installation of its own.
    step('The demo seed refuses an installation that already has its organisation');
    const refused = spawnSync(process.execPath, ['prisma/seed-demo.mjs'], { env: env({}), encoding: 'utf8' });
    const refusedOk = refused.status !== 0 && /already has its organisation/.test(`${refused.stderr}${refused.stdout}`);
    console.log(`${refusedOk ? 'PASS' : 'FAIL'}  the demo seed refuses a second organisation`);
    outcomes.push(['local: one organisation per installation', refusedOk]);
    await stopServer();
    step(`Fresh database ${database} for the demo`);
    psql(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
    psql(`CREATE DATABASE ${database}`);
    run('npx', ['prisma', 'migrate', 'deploy']);
    step('Seed the platform admin and the demo organisation');
    run('node', ['prisma/seed.mjs']);
    run('node', ['prisma/seed-demo.mjs']);
    await startServer({}, { build: false });
    step('The rest of the app');
    outcomes.push(['local: demo and groups', suites(['e2e-demo.mjs', 'e2e-group.mjs', 'e2e-access.mjs', 'e2e-instructor-links.mjs', 'e2e-group-instructors.mjs', 'e2e-accounts.mjs', 'e2e-export.mjs', 'unit-access-rules.mjs'])]);
  }
} catch (error) {
  outcomes.push(['setup', false]);
  console.error(`\n${error instanceof Error ? error.message : error}`);
} finally {
  await stopServer();
  if (!flag('keep-db')) {
    try {
      psql(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
    } catch {
      // The container is gone; nothing to clean up.
    }
  }
}

console.log(`\n${edition} edition`);
for (const [name, ok] of outcomes) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}`);
}
process.exit(outcomes.length && outcomes.every(([, ok]) => ok) ? 0 : 1);
