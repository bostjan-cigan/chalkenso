# Contributing

Thank you for helping. Bug reports, questions and ideas are welcome as issues. Pull requests are
welcome too; for anything bigger than a fix, open an issue first so we can agree on the approach.

## Before you open a pull request

```bash
yarn typecheck
yarn lint
node scripts/test-edition.mjs local   # needs Docker: a fresh database, a production build, every end-to-end test
```

Keep changes focused, match the code around them, and add or update an end-to-end check in
`tests/e2e/` when behaviour changes.

## Contributor agreement

This repository is published from the code that also runs the hosted Chalkenso, and it is offered
under licenses for organisations as well as the Business Source License 1.1. To accept your
contribution, we need the right to use it under both. So, before your first pull request is
merged, you agree that:

- you wrote the contribution, or have the right to submit it;
- you give the maintainer a perpetual, worldwide, royalty-free license to use, change, sublicense
  and distribute it, under the Business Source License 1.1, its Change License, and any other license, including commercial
  ones;
- you keep the copyright in your contribution.

Say so by adding this line to your pull request description:

> I agree to the contributor agreement in CONTRIBUTING.md.
