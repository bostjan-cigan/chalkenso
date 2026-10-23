# Chalkenso (local edition)

AI-assisted curriculum design you host yourself. Plan courses that hold together, annotate them
while you teach, collect what learners say, and let AI draft the next version. People approve every
change.

This is the **local edition**: the same app as the hosted Chalkenso, for one organisation on your
own server. It is **source-available** under the [Business Source License 1.1](LICENSE): anyone may
read, change and test it, and running it is free for an individual's personal, non-commercial use
(study, hobby projects, a course taught for free). Schools, universities, companies, trainers who
teach for a fee, and anyone using it for work need a license or the hosted version. Each version
becomes open source (Apache 2.0) four years after it is published ([LICENSING.md](LICENSING.md)).

## What it does

| Area | What you get |
|---|---|
| Design | Courses, versions, parts (arcs) and lessons, edited in the browser or synced from Obsidian. **Revise with AI** rewrites a lesson from an instruction and shows every changed line before you use it. |
| Teach | Groups with their own copy of a course, private expiring learner links, rosters. Learners read, leave feedback on a passage, keep private notes, and ask an AI assistant about a paragraph. |
| Annotate | Team members open the **team preview** of a course and add **instructor notes** on any passage (shared with the team) or private notes. |
| Improve | Feedback and notes land in one inbox; turn them into tasks. **Draft with AI** writes the revision plan from the lesson, its open feedback and notes, and the course outline. You edit and save it. |
| Decide | Choose whether a group's change stays with the group or goes into the main course. Publish new versions when ready. |
| Team | One manager and the instructors they invite (invite links), each with every course or only chosen courses or groups. |

One organisation per installation: the first person to sign up is its manager, and instructors join
with an invite link. Learners read on this installation, through their personal links. Serving
courses on another website (the website API) is part of the hosted version.

## Run it with Docker

```bash
echo "SESSION_SECRET=$(openssl rand -hex 32)" > .env
docker compose up -d
```

Open http://localhost:3000: a new installation asks you to set it up, and the account you create is
its manager. There is no landing page, just the app; build your own page around it if you want one.
The database is migrated on every start; data lives in Docker volumes
(`curriculum-ai-postgres-data`, `curriculum-ai-media`).

Settings in `.env`:

| Setting | |
|---|---|
| `SESSION_SECRET` | Required. A long random string; it also encrypts stored AI keys, so keep it. |
| `NEXT_PUBLIC_APP_URL` | The address people use, when it isn't `http://localhost:3000` (rebuild after changing it). |
| `APP_PORT` | The port on your machine (default 3000). |
| `ANTHROPIC_API_KEY` | Optional: one AI key for the whole installation. |
| `POSTGRES_PASSWORD` | The database password (default `postgres`; the database port is open only on this machine). |

## AI

AI drafts with Claude. Bring your own key: the manager pastes an Anthropic API key in
**Settings → AI** (stored encrypted, shown only by its last four characters), or the server sets
`ANTHROPIC_API_KEY` for everyone. Without a key the AI buttons are hidden. `AI_MOCK=1` returns
sample output without calling the API (demos and tests).

## Obsidian and Claude Code (optional)

Write lessons in an Obsidian vault and sync them with this installation, then let Claude Code check
courses, plan feedback and apply plans you approved, on your own Claude plan (no API key). The
plugin and its Claude Code kit have a repository of their own, [chalkenso-obsidian](https://github.com/bostjan-cigan/chalkenso-obsidian)
(MIT).

1. **The plugin.** Download `main.js`, `manifest.json` and `styles.css` from its latest release into
   `<vault>/.obsidian/plugins/chalkenso/`, and enable **Chalkenso** under Obsidian's **Settings →
   Community plugins**.

2. **Connect it.** In Chalkenso, open **Tokens** at the bottom of the sidebar and create a token. In
   Obsidian, **Settings → Chalkenso**: set **Server URL** to `http://localhost:3000` (or your
   `NEXT_PUBLIC_APP_URL`), add your organisation with the token, and tick the courses to sync.
3. **Claude Code** (needs Python 3.8 or later) gets the skills, scripts and instructions for the vault,
   from a copy of chalkenso-obsidian:

   ```bash
   python3 claude/install.py "<vault>"
   ```

   Open Claude Code in the vault and start with "run enrich-lessons on <course>". Run the installer
   again after updating to get the latest skills.

The [plugin's README](https://github.com/bostjan-cigan/chalkenso-obsidian#readme) explains syncing, feedback plans and the Claude
Code kit in full.

## Develop

Requires Node.js 20, Yarn and Docker.

```bash
cp .env.example .env.local        # then set SESSION_SECRET
yarn install
yarn db:up                        # PostgreSQL in Docker (POSTGRES_PORT, default 5433 in the example)
yarn db:migrate
yarn dev                          # http://localhost:3100
```

`yarn db:seed-demo` sets up a demo organisation (`DEMO_EMAIL` / `DEMO_PASSWORD`) on an empty installation
(one organisation per installation: on one that already has its organisation, it refuses).

Checks:

```bash
yarn typecheck
yarn lint
yarn i18n:check                       # every language has English's messages, placeholders and tags
node scripts/test-edition.mjs local   # fresh database, production build, every end-to-end test
```

`yarn test:e2e` runs the end-to-end tests against a server that is already running.

## How it is built

- Next.js (App Router), React, Prisma on PostgreSQL.
- **Organisation scoping** lives in the database client (`src/lib/prisma.ts`).
- AI lives in `src/lib/ai.ts` (and which key it uses in `src/lib/ai-key.ts`); it never writes to
  the database.
- `src/extensions/` is where an edition adds to the shared app; this repository has the local one.
- Languages: English and Slovenian, with next-intl (`src/i18n/`, words in `src/i18n/messages`).
  Signing in and the learner pages follow the language picked in their corner (learner pages start
  in the course's language); the app is English for now.
- The Obsidian plugin that syncs lessons, images and feedback plans with your installation, and the
  Claude Code skills that check courses, plan feedback and apply approved plans in your vault, are in
  [chalkenso-obsidian](https://github.com/bostjan-cigan/chalkenso-obsidian); its sync API is `src/app/api/sync/`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[Business Source License 1.1](LICENSE), with a grant for personal use; each version becomes Apache 2.0
four years after it is published. See [LICENSING.md](LICENSING.md) for what that means in
practice and how to get a license for your organisation.
