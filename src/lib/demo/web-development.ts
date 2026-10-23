import type { DemoArc, DemoLesson } from './types';

/**
 * The demo's flagship course, Web Development II: fifteen lessons in three arcs, building one
 * Recipe Keeper app from server-rendered pages to a tested, deployed single-page app.
 */

export const WEB_DEVELOPMENT_LESSONS: DemoLesson[] = [
  {
    arc: 0,
    title: 'Course intro, Docker setup and your first page',
    slug: 'course-intro-docker-setup',
    short: 'Install Docker, run Flask and Postgres with one command, and serve your first page from a real database.',
    md: `**Duration:** 1.5 hours

**Goal:** Run the Recipe Keeper's first version — a Flask app and a PostgreSQL database — with a single command, and serve a page whose data comes from the database.

## What Docker is, in one sentence

Docker runs each part of your app in its own small, isolated computer called a **container**, built from a recipe called an **image**. Your laptop stays clean, and everyone in the room runs exactly the same versions.

## Run Flask and Postgres with one command

Create \`compose.yaml\` in the project folder:

\`\`\`yaml
services:
  web:
    build: .
    ports:
      - "5000:5000"
    env_file: .env
    depends_on:
      - db
  db:
    image: postgres:16
    env_file: .env
    volumes:
      - recipes-data:/var/lib/postgresql/data
volumes:
  recipes-data:
\`\`\`

The named volume keeps the database files outside the container, so your recipes survive a restart. Start everything with:

\`\`\`bash
docker compose up --build
\`\`\`

Open http://localhost:5000 and you should see the welcome page.

> [!tip] Build → run → verify
> Stop the stack with \`docker compose down\`, start it again, and check that the recipe you added is still there. If it is, the volume works.

## Your first page from the database

In \`app.py\`, read the recipes and hand them to a Jinja template:

\`\`\`python
@app.get("/")
def index():
    recipes = db.session.scalars(select(Recipe).order_by(Recipe.created_at.desc())).all()
    return render_template("index.html", recipes=recipes)
\`\`\`

The template loops over them and shows each title. Add one recipe by hand in \`psql\`, refresh the page, and watch it appear: the page now comes from a real database, not from a list in your code.

## Homework

Add a \`description\` column to the page, and make the empty state say "No recipes yet" instead of showing an empty list. Next time, in [[A REST API with full CRUD]], the same recipes come back as JSON.`,
  },
  {
    arc: 0,
    title: 'A REST API with full CRUD',
    slug: 'rest-api-with-full-crud',
    short: 'Expose recipes as a REST API with APIFlask: validation and docs for free.',
    md: `**Duration:** 1.5 hours

**Goal:** Expose the recipe data as a REST API next to the pages, with validation and documentation generated from the code.

## Pages vs APIs

A page returns HTML for a person to read. An API returns JSON for another program to use. The Recipe Keeper will have both: the pages you built last time, and an API that a React app will call in Part II.

## Create, update and delete

Each endpoint is described once, with a schema. APIFlask validates the input against it and returns a **422** with a clear message when a field is missing, before your code runs.

\`\`\`python
@app.post("/api/recipes")
@app.input(RecipeIn)
@app.output(RecipeOut, status_code=201)
def create_recipe(json_data):
    recipe = Recipe(**json_data)
    db.session.add(recipe)
    db.session.commit()
    return recipe
\`\`\`

Return **201 Created** for a new recipe, **204 No Content** after a delete, and **404** when the id doesn't exist.

## Verify with an API client

Open \`/docs\`: the documentation is generated from your schemas. Try each endpoint there with a normal input, an empty one and a weird one.`,
  },
  {
    arc: 0,
    title: 'Authentication and authorization',
    slug: 'authentication-and-authorization',
    short: 'Add login and roles with Flask-Security-Too, and learn why you never build auth yourself.',
    md: `**Duration:** 1.5 hours

**Goal:** Add real authentication and roles to the Recipe Keeper using a maintained library, and understand why this is the one part of the course you never build by hand.

## Why you never build auth yourself

Password storage, session handling and CSRF protection each have well-known ways to go wrong. A vetted library has already made those mistakes and fixed them. The same goes for asking an AI to write it for you: it will produce something that looks right.

## One login for pages and API

Flask-Security-Too stores a **session cookie** after login. The browser sends it with every request, for the pages and for the API alike.

## The CSRF protection cookies need

Because the browser sends cookies automatically, another site could make a request on your behalf. A CSRF token, sent with every form and API call that changes data, proves the request came from your own pages.`,
  },
  {
    arc: 1,
    title: 'From Python to the browser',
    slug: 'from-python-to-the-browser',
    short: 'Map what you know from Python to JavaScript, and set up React with TypeScript.',
    md: `**Duration:** 1.5 hours

**Goal:** Read and write basic JavaScript by mapping it to the Python you already know, then create a React + TypeScript project.

## The same ideas, different syntax

Variables, functions, lists and dictionaries all exist in JavaScript. Write each one in both languages side by side before moving on.

## Your first React component

A component is a function that returns what should appear on the page. Start with a list of recipe titles, hard-coded, then replace them with data from your API in the next lesson.`,
  },
  {
    arc: 2,
    title: 'Test and document the API',
    slug: 'test-and-document-the-api',
    short: 'Write pytest tests against a separate test database.',
    md: `**Duration:** 1.5 hours

**Goal:** Test every endpoint against a separate test database, and keep the generated docs honest.

## A database just for tests

Tests must never touch your development data. Point the test run at its own database with an environment variable, and create a fresh schema for every run.

## Normal, empty, weird

For each endpoint, write three tests: a normal input, an empty one and a weird one. That habit catches most bugs before your users do.`,
  },
];

export const WEB_DEVELOPMENT_ARCS: DemoArc[] = [
  ['Part I – Server-rendered', 'Build the Recipe Keeper as a Flask app on Postgres, in Docker.'],
  ['Part II – Single-page app', 'Convert the frontend to React and TypeScript.'],
  ['Part III – Test and ship', 'Tests, a CI/CD pipeline and a monitored deployment.'],
];
