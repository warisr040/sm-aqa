# Aquarian Age Thailand Fan-site

(Formerly Aquarian Age Helper.)

Card search, deck builder and bilingual rules guide for Aquarian Age.
Live site: https://aquarian-age-helper.netlify.app/

## Build

```
pip install openpyxl
python3 build.py
```

Output: `dist/aquarian-age-helper/` (drag this folder onto Netlify → Deploys) and `dist/aquarian-age-helper.zip`.

## Layout

| Path | What it is |
|---|---|
| `data/cardlist.xlsx` | Card database: names (JP/EN), stats, skills, card text (replace this file to update cards) |
| `data/old_keys.json` | Old deck keys → current keys (3,052), so deck lists saved by earlier versions still import |
| `src/index.html` | Page markup; `@PLACEHOLDERS` are filled by the build |
| `src/css/app.css` | All styles (design tokens at the top) |
| `src/js/01-core.js` | Data model, constants (categories, stats, class icon names), helpers, saved settings |
| `src/js/02-filters.js` | Search, faceted filters, class icon + skill checklists, multi-sort, result lists |
| `src/js/03-deck.js` | Deck rules, category buttons, deck board, drag-and-drop |
| `src/js/04-export.js` | Export (image / text), Import, How-to-use dialog, deck image drawing |
| `src/js/05-sheet.js` | Card details panel, shared click handling |
| `src/js/06-template.js` | Deck templates (Template #1 Full Deck, Template #2 Characters Only) |
| `src/js/07-app.js` | Tabs (Home, Card List, Rulebook, Deck Builder, Game Table, Changelog), Home page buttons, phone layout switch, Rules language, keyboard, starry background, start-up |
| `src/partials/help.html` | Deck Builder "How to use" guide (Thai) |
| `src/rules_content.py` | Bilingual rules guide (JP / EN) |
| `assets/firebase-config.js` | Firebase web config for online rooms on the Game Table (`window.AA_FIREBASE = {...}`); without it only test rooms work |
| `src/changelog.json` | Changelog tab entries (newest first; add a new entry at the top for each update) |
| `assets/` | Banner, help screenshots, class icons (rulebook p.13), faction marks (rulebook p.6) |
| `tests/test_site.py` | Headless regression tests |
| `docs/requirements_v4.md` | v4 rebuild requirements (change requests go here first, as {Revise#NNN}) |
| `docs/requirements_v4.html` | Readable page made from the .md by `python3 build.py` (contents, search, filters) — don't edit it by hand |
| `src/engine/*.js` | v4 rules engine (namespace `AA4`, headless; not in the site build until step B7): state, log, phases, declarations, battle, triggers, effects, skills — file list in the header of `00-base.js` |
| `src/table4/` | v4 game table page (`table.html`): `page.html`, `table.css`, `t1-app.js` (rooms, transports, log), `t2-render.js` (boards, Resolve box, hand), `t3-input.js` (clicks, menus, pop-ups). Built with `src/engine/` into `assets/table.js` |
| `tests/table_ui.js` | v4 table browser tests: `python3 build.py && node tests/table_ui.js` |
| `tests/target_attack_ui.js` | Game Table: the “Targeting attack” menu line and the pick on the field (Revise#428): `node tests/target_attack_ui.js` |
| `src/coverage/page.html` | Card rule coverage page (`coverage.html`): status of every card from `rules.js`, lines still done by hand |
| `tools/rules_compile.py` | v4 rule database compiler: every card of the card list → `dist/…/assets/rules.js` (run by build.py; prints the coverage report) |
| `tests/engine/run.js` | v4 engine tests: `node tests/engine/run.js` (unit, rules B2–B6 in `rules_tests.js`, scenarios in `tests/engine/scenarios/`, random legal games, real card list after `python3 build.py`) |
| `tools/manual/` | User Manual page (`manual.html`, English / Thai): `manual.py` holds the text of each chapter, `tpl.py` the page template; pictures in `assets/manual/`. Built by build.py and linked from the Home page |
| `tools/targets.py` | Reads every ≪target≫ in the card list and writes targets_catalog.xlsx (summary + all 1,405 wordings) |
| `tools/requirements_html.py` | docs/requirements_v4.md → docs/requirements_v4.html (run by build.py) |
| `tools/effects_xlsx.py` | Writes a copy of the card list with effect columns (count, costs, JP / EN text per effect) |

The JS files are joined in name order into `assets/app.js`. They are plain scripts (not modules), so the
site also works when `index.html` is opened straight from disk.

## Test

```
pip install playwright && python3 -m playwright install chromium
python3 build.py && python3 tests/test_site.py path/to/Sortable.min.js
```

Saved in each browser: `aa-deck` (current deck), `aa-cat` (last category per card), `aa-ui` (tab, filters, view settings).
