# احسبها: notes for Claude

A static Arabic accounting app (`ahsebha/`: ES modules, no build step, data kept on the device in IndexedDB), its desktop shell (`desktop/`: a small Electron app that opens the live site) and the owner's own tools (`ahsebha/owner.html`, `ahsebha/plans.html`). GitHub Pages serves `main`, so a merge to `main` is a release of the web app (about 30 to 70 seconds later).

## Updates log: required for every update

The owner asked that every update that is released gets a version number and a plain-Arabic description of what changed, shown on the owner's page (`owner.html` → «التحديثات»). So with every change that reaches users (a feature, a fix, a visual change, a new desktop installer):

1. Add a new entry at the top of `CHANGELOG` in `ahsebha/js/changelog.js` (newest first). The current version is the first entry's `v`.
   - New feature: bump the middle number (1.6.0 → 1.7.0). Fix or small tweak: the last number (1.6.0 → 1.6.1). A change that alters how people use the program: the first number (1.x → 2.0.0).
   - `title` is short. `items` say what changed in simple Arabic the owner understands (what happened and what users will notice), not developer language.
   - If a new desktop installer is released, also set `desktop` to the new `version` of `desktop/package.json`.
2. Run `cd ahsebha && npm test`. `test/changelog.test.mjs` checks the order, the format and that the desktop version in the log is the real one.
3. Write the new number in the PR description and in the report to the owner.

Changes that do not reach users (CI only, tests, docs) do not need an entry.

## Commands

- Web app tests: `cd ahsebha && npm test`.
- Desktop app: `cd desktop && npm test` for the navigation rules. The real builds and the smoke tests on Windows, macOS and Linux run in `.github/workflows/desktop.yml` (on pull requests that touch `desktop/`).
- Desktop release: raise `version` in `desktop/package.json`, merge, then run that workflow on `main` with `release: true`. It publishes `desktop-v<version>` with fixed file names, so `releases/latest/download/<name>` links keep working.

## Good to know

- Subscriptions are dormant until the owner decides what is free and what is paid: `enforce` and `published` in `ahsebha/js/plans.js` are `false`, and the owner's public key line is not in `js/license-key.js` yet. Do not switch them on without being asked.
- The owner is not technical and reads Arabic: keep reports short, simple and in Arabic.
