# كنز (formerly احسبها): notes for Claude

The program is called «كنز» (Kenz); its old name was «احسبها». The folder, URL, storage keys and ids still say `ahsebha` on purpose (see below). A static Arabic accounting app (`ahsebha/`: ES modules, no build step, data kept on the device in IndexedDB), its desktop shell (`desktop/`: a small Electron app that opens the live site) and the owner's own tools (`ahsebha/owner.html`, `ahsebha/plans.html`). GitHub Pages serves `main`, so a merge to `main` is a release of the web app (about 30 to 70 seconds later).

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

## Name, look and icons

- The display name lives in `ahsebha/js/brand.js` (`BRAND`); pages and texts use it. Do not rename the technical ids: the URL path `/ahsebha/` (IndexedDB is per origin and path, so changing it would hide every user's data), the `ahsebha-*` localStorage keys, the `AHS1.` licence codes, the `AHSEBHA_URL` variable and `resources/ahsebha`.
- Look: design tokens at the top of `ahsebha/app.css`, the IBM Plex Sans Arabic font is self-hosted in `ahsebha/fonts/` (precached by `sw.js`, no Google Fonts), the logo is `ahsebha/icons/icon.svg` (master and generators in `tools/`, see `tools/README.md`).
- Icons are inline SVG (Lucide, ISC) from `js/icons-data.js`. Writing an emoji in a template is still fine: `watchIcons()` swaps every emoji listed in `EMOJI` for its icon, except inside inputs, `.paper` and `#print-area`. For a new icon add it in `tools/build-icons-data.cjs` and regenerate; build markup in code with `icon('name')`. `data-icon` on the svg carries its name.
- The mobile bottom bar (`#tabbar`, hidden on forms and POS by `hidesTabbar` in `app.js`) and the quick search (`views/palette.js`, Ctrl/Cmd+K and `/`) are part of the shell. `dialog` elements need `margin: auto` (the global reset removes the browser default).
- Store and install screenshots are generated from the real UI: `node tools/store-assets.cjs`.

## Good to know

- Desktop: `appId` and the `Ahsebha` user-data folder (`userDataDir` in `desktop/policy.js`) must never change, even though the product is now `Kenz`: they keep the data of everyone who installed the old version. CI asserts it on all three systems. Installer file names (`Kenz-Setup.exe`, ...) are mirrored in `ahsebha/js/downloads.js` and checked by `test/install.test.mjs`.

- Subscriptions are dormant until the owner decides what is free and what is paid: `enforce`, `published` and `requireCode` in `ahsebha/js/plans.js` are `false`, and the owner's public key line is not in `js/license-key.js` yet. Do not switch them on without being asked.
- Invoice-level discount: `doc.discMode` (`'pct'` or `'amt'`) + `doc.discVal` on any document with lines. `calcDoc` allocates it to the lines in proportion to their amounts after their own discounts (rounding remainder to the last line that has room) before tax, so lines' `net/vat/total`, postings, stock valuation and the VAT report need no special case; `docDiscount` and each line's `docDisc` expose it. Returns and the cancellation credit note inherit it as a percentage (`inheritedDiscount`), never as copied line shares. A new document field must be added where documents are copied (`copyRef`, `query.from/copy` in `views/docs.js`, `cancelCreditNote`, the POS cart and held carts).
- Price lists: `db.priceLists` (`{id, name, pct}`, negative `pct` = discount), `party.priceList` (id or `''`, written explicitly because `saveParty` merges), `product.listPrices` (`{listId: price}`, a specific price beats the percentage). `listPrice(db, product, listId, unit)` in `core.js` is the only pricing rule; it is applied when a product is added to a sale document or the POS cart, on unit change, and on customer change (a confirm dialog offers repricing). Sellable feature `pricelists`: with enforcement on and no entitlement `listId()` is empty and the normal price is used. In `views/docs.js` the helpers are function declarations on purpose: `lineFromProduct` is called before the later code of the form runs.
- Customer credit limit: `party.creditLimit` (0 = none, written explicitly because `saveParty` merges), `creditCheck(db, books, doc, existing)` in `core.js` is called from `views/docs.js` save and POS checkout; `settings.creditPolicy` is `'warn'` (confirm dialog) or `'block'`.
- The activation gate (`requireCode` in `plans.js`, `gateOn`/`gateOpen` in `license.js`, `views/gate.js`, called from `boot()` in `app.js` right after `license.init()`): when on, a copy without a valid code for this device shows only the code screen and nothing is rendered behind it; `#app` is `inert` while it shows. It only turns on if the owner's public key is installed (without a key no code can be accepted, so everyone would be locked out). A device-bound code (`d`) does not work when copied to another device. An expired code gets `graceDays`, then locks, and `boot()` re-checks every hour. The gate has a data download button unless the company has PIN users. It beats `demoPublic`: a trial then needs an owner-issued demo code. Going live is one step: put the key line in `js/license-key.js`, switch on `requireCode` (or `demoPublic` for a public trial) together with `enforce`, change the «free» wording in `index.html`, `plans.html` and `download.html`, and cut a desktop release so the shipped copy carries it (installers from before keep working offline until they go online once). It is a deterrent, not hard protection: the program files are public and can be edited.
- The demo version («نسخة العرض», `ahsebha/js/license.js` `demo()` and `docGate`/`docCreated`, called from `store.saveDoc`) caps invoices (`sale` and `purchase`, POS included) and days, marks printed invoices «نسخة تجريبية», and the owner's subscription code lifts it. Owner-issued demo codes (payload field `n`) always work; `demoPublic` in `plans.js` is what turns every unlicensed copy into a demo, and it is `false` until the owner decides. When it is switched on, also cut a new desktop release so the shipped copy carries it. The limits are deterrents on the customer's own device, not hard protection.
- The desktop installer ships a copy of `ahsebha/` (`extraResources` in `desktop/package.json`; `store/`, `test/`, `*.md` and `package.json` are left out). `desktop/offline-site.js` serves it only when the network fails, after the last copy saved on the device, so the app opens with no internet from the very first launch while online it always shows the live site. A new desktop release refreshes the shipped copy. Anything the program needs at run time must live inside `ahsebha/`.
- The build checks that behaviour on all three systems (`ci/check.js` asserts on the smoke result). Use `--proxy-server=127.0.0.1:9` with `--smoke-no-network` to cut the connection, and `--disable-http-cache` so the browser's cache cannot hide the app's own copies.
- The owner is not technical and reads Arabic: keep reports short, simple and in Arabic.
