# End-to-end checks

They drive your installed Chrome (`CHROME_PATH` to override) through the app, with `AI_MOCK=1` for
the AI features.

The whole thing from scratch, as before a release: a fresh database in the docker-compose Postgres,
migrations, a production build on port 3102, and every suite in the order the edition needs:

```bash
node scripts/test-edition.mjs local
```

Against a server that is already running (`yarn dev`, or `BASE_URL`), with the demo organisation
seeded (`yarn db:seed-demo`):

```bash
yarn test:e2e                    # every suite that fits the server
yarn test:e2e e2e-demo.mjs       # just these
```

Suites that can't run in the server's state (sign-up closed, say) skip themselves.

| Script | Covers |
|---|---|
| `e2e.mjs` | Sign-up, course and lesson creation, Revise (AI), invites, a colleague editing the same lesson, team roles; then, by edition, isolation between organisations or a closed sign-up, no website pages the organisation's own AI key and no website API. Needs open sign-up. |
| `e2e-demo.mjs` | Learner link and feedback, instructor notes, inbox, Use (feedback into its lesson's improvement), AI-drafted plan (written in the background: its stages and text while watched, waiting after leaving the page, Discard and Stop), deleting an improvement keeps its feedback, API token scoped to the organisation, arcs created through sync |
| `e2e-improve.mjs` | One improvement per lesson (AI mocked; puts the demo rows back): the Improve column beside the lesson, feedback in by default with Leave out (a reply required), Use on the Feedback list, Improve this lesson writing the plan (following the notes for AI) and the changes in one go, feedback used after the draft waiting for the next improvement, one Publish on the group's copy that also changes and publishes the main course's lesson (Undo takes it back out there), a plan written before more feedback updated by the next Improve; a diagram AI drew, where the main course's text differs a little waiting there as a draft, reviewed there and bound (the same image) when saved |
| `e2e-improve-thread.mjs` | An improvement's thread (AI mocked): Ask for changes on a draft with a change skipped gets a new attempt that goes on from it (the request and the attempt it continues kept), earlier attempts with Use this one, a stopped turn leaving the attempt waiting, the message field on a phone; the Done tab as the lesson's history, with how the changes came about and edits published without an improvement |
| `e2e-feedback-select.mjs` | Picking many pieces of feedback at once on a group's Feedback list (AI mocked): grouped by lesson, Leave out with one reply (required) for several, a lesson's box and Fix with AI drafting each lesson and opening the first |
| `e2e-feedback-round.mjs` | Sort with AI on a group's copy (AI mocked; puts the copy back): one page of lesson cards and left-out notes with suggested replies only as placeholders, Use confirming one (sent, done) while one without a reply stays open, Approve drafting the lessons and opening the first ("Lesson 1 of N"), Next after Publish, and the learner seeing once on their next visit what changed or got a reply |
| `e2e-group.mjs` | Creating a group with a roster; links for all learners, copied in one go; a learner's feedback following them to a link made again (and from an earlier link of theirs); feedback from a learner no longer on the roster moved to one on it, showing on their link; the group page hydrating without warnings; feedback exported as CSV (the group's, the course's, the course's own lessons), learners never named and formula-looking cells kept as text |
| `e2e-access.mjs` | Member access: owners keep everything; a member limited to a course (invite with Access); an instructor of one group that reads the core (its lessons read only, its learners' feedback only, class notes need the group, exporting only its group's feedback); feedback read only; another organisation's course refused; access per organisation; no group left means nothing; removing a member removes their rules |
| `e2e-instructor-links.mjs` | Instructor links: your own link from the group page (bound to you and the group, following it); the learner pages in instructor view; marks are instructor notes under your name for the group; private notes are your team notes; a guest instructor (notes only) invited for one group sees only "Your groups" and reads the group's lessons in the team preview (the group's instructor notes, never learner feedback, another group, the course or the version's pages); every instructor sees the group's notes and deletes only their own; losing access or leaving the team ends the link |
| `e2e-group-instructors.mjs` | Group instructors: adding a member limited to another course (the group added at their level); "taught by" on the group page and list; Overview and "My groups" for the instructor; "Taught by" on the learner page; a group's task offers its instructors first; removing keeps their access; leaving the team ends it |
| `e2e-accounts.mjs` | Accounts and email (needs Mailpit: `SMTP_HOST`, `yarn mail:up`): an invite emailed from the Team page; signing up from it with a handle; "Forgot your password?" (the same answer for an unknown email), the reset link once, every session ended, the old password refused |
| `e2e-sessions.mjs` | Sessions: Keep me signed in (14 days without activity, 30 at most, a lasting cookie) or not (2 hours, 12 at most, a cookie gone with the browser); Profile's Where you're signed in (this browser first, browser and system; a row opens its details, Cancel the default, Tab kept inside) signing one out, and Sign out of all devices (every session, this one too; the sign-in page says so; remembered browsers count as new again); "Are you still there?" before a session runs out, Stay signed in moving it on; the sign-in page saying it ended and coming back after; the hard end; an owner signing a member out of the organisation from Team (older sessions can't come back, signing in again works); five wrong passwords locking new browsers out of an account for 15 minutes (the right one too, until it runs out; a forged remembered-browser cookie too), while a browser that signed in before still gets in and has its own lock; signing in clears the count; an email without an account locks the same way; on a touch screen the ⋯ and compact buttons are 44px, with a mouse 32px; two-factor on from Profile (password, code, backup codes), a code asked at sign-in (a wrong one refused), off with the password |
| `e2e-export.mjs` | Export everything (Settings → Export): the owner's .zip unzips into one folder whose README.txt names every file; the lessons as the Obsidian plugin keeps them (a folder per version and group copy, a note per lesson with the plugin's properties, an embedded image in `_attachments`), the version history with who published (through the sync API) and each published text, feedback (learners never named), tasks, team, rosters; no secrets (sync token, AI key, learner links, invite and share hashes, password hashes, sessions) and nothing from another organisation; a member limited to one group gets that group only |
| `unit-access-rules.mjs` | The access rules without a server: what each grant covers, owners and admins always full, LIMITED with no rows means nothing, the Team page presets, a guest instructor's preview (only the version their group reads) |
| `unit-callouts.mjs` | Obsidian callout titles in rendered lessons: inline formatting and the spaces between its parts kept, default titles |
| `unit-ai-drafts.mjs` | Background AI drafts: the plan shown while Claude writes it (inside its tag, no half-arrived closing tag), when a running draft counts as stopped, the elapsed clock |
| `unit-feedback-rounds.mjs` | One improvement per lesson: which open improvement is the lesson's, feedback joined after the plan, what a save answers and what waits for the next improvement |
| `unit-proposed-changes.mjs` | Proposed changes: a draft split into separate changes (an edited paragraph with its words, new paragraphs, removed ones), spacing and list markers not counted, some kept and others skipped, each placed against the person's edits since (clean, conflict, gone, done), Use proposed on a conflict, and Undo after Apply that keeps what was typed since |
| `unit-review-queue.mjs` | Working through lessons one after another: where the lesson open is ("Lesson 3 of 8"), the next one waiting for review (round the end), else the next being written |
| `unit-feedback-round.mjs` | Sort with AI's rules: AI's answer made safe (every note once, a note changes only its own lesson, duplicates, what AI missed left out), the page's edits checked, replies kept apart from suggestions, the mock answering the same every time |

They create test accounts and organisations in the database they run against.
