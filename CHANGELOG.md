# Changelog

<!--
Maintained by `pnpm changelog` (changelogen). Before a release, edit this
"Unreleased" section as needed; `pnpm release` will then cut the version.
-->

## [Unreleased]

[compare changes](https://github.com/jiaojiaodubai/banyan/compare/v0.3.0...main)

### 🚀 Enhancements

- **multilingual items:** Create a copy of an item in another language from the item context menu; Banyan links the copy and its source into a multilingual group, so one reference can be cited in several languages
- Edit that copy in a dedicated window beside a preview of its source (PDF, ePub, snapshot, web page, or URL), with Zotero's own field rows, creator name modes, date parsing, and local-time display
- Accept a language tag written as BCP 47 and, when a copy in that language already exists, offer to jump to it or to change the language instead of creating a duplicate
- Move a whole multilingual group to a new item type when one member changes type, listing the fields each member would lose
- Show the group in the item pane the way Zotero shows related items, and leave the Banyan menu out where Zotero hides its own item actions, such as the trash
- Select the copy you saved, or an existing copy you jump to, in the item list, and tell you when a member could not join the group or no longer matches the group's item type
- **inaccessible-items:** Report only the reasons and solutions that were actually found, count per item instead of per citation, and offer the import action only when something can be imported
- **refresh:** Replace stale item URIs in the incoming contexts before the sandbox runs and return the refreshed identities with `citations[].source`, so the front end can drop what merged duplicates left behind in the document (documented on `RefreshRequestData.syncItems`)

### 🩹 Fixes

- **style:** `getMultilingualItem()` resolves a list of language preferences in order — a sibling matching an earlier preference now wins over the item itself matching a later one; before, any preference that matched the item returned the item
- **inaccessible-items:** Resolve merged duplicates through their `dc:replaces` relation before reporting an item as deleted, so citing a merged item no longer raises an "item may have been deleted" prompt
- **inaccessible-items:** Normalize the library type parsed from an item URI, which had never matched the checks against it and left the cross-library and unknown-group branches dead; the current user's own local URI is no longer mistaken for a cross-library one

### 💅 Refactors

- **item:** Keep merged-item resolution and refresh-time context hydration in one implementation, shared by the refresh endpoint, the field converter, and the style editor, with Node regression tests for both

### 📖 Documentation

- **style:** Spell out how `getMultilingualItem()` resolves language preferences

### 🏡 Chore

- **deps:** Upgrade `zotero-plugin-toolkit` to 5.2.0; use Zotero's native menu manager and raise the minimum Zotero version to 8.0
- **locale:** Regenerate Fluent typings after dropping the message ids the inaccessible-items dialog no longer uses

## v0.3.0 (2026-09-29)

[compare changes](https://github.com/jiaojiaodubai/banyan/compare/v0.2.0...v0.3.0)

### 🩹 Fixes

- **lifecycle:** Release dialog trees, registrations, and locks cleanly ([555f185](https://github.com/jiaojiaodubai/banyan/commit/555f185))
- **ui:** Prevent text selection in virtualized tables ([e359104](https://github.com/jiaojiaodubai/banyan/commit/e359104))

### 💅 Refactors

- **citedItemsSearch:** Back cited-items rows with in-memory searches ([0c42573](https://github.com/jiaojiaodubai/banyan/commit/0c42573))

### 📖 Documentation

- **readme:** Rework badges and split style authoring from installation ([ad278b4](https://github.com/jiaojiaodubai/banyan/commit/ad278b4))

### 🏡 Chore

- **deps:** Refresh lockfile ranges — `@types/node` `24.19.0`, `prettier` `3.9.9`, `tsx` `4.23.15`

### ❤️ Contributors

- Jiaojiaodubai

## v0.2.0 (2026-09-21)

[compare changes](https://github.com/jiaojiaodubai/banyan/compare/v0.1.0...v0.2.0)

### 🚀 Features

- **integration:** Ship the performance-optimized front ends — WPS add-in `1.1.1` and Word template `1.2.0`; bump both submodule pointers
- **style:** Require id for bibliography-title; sync typings, normalization, tests, docs, and WPS ([f7173ad](https://github.com/jiaojiaodubai/banyan/commit/f7173ad))

### 🩹 Fixes

- **sandbox:** Make markup splitting work in the in-Zotero test page ([b5fcc1c](https://github.com/jiaojiaodubai/banyan/commit/b5fcc1c))
- **typings:** Make style-facing declarations standalone-valid and clarify AI guidelines ([17cd5b1](https://github.com/jiaojiaodubai/banyan/commit/17cd5b1))
- **sandbox:** Resolve DOM node types locally when splitting markup ([fc5dc63](https://github.com/jiaojiaodubai/banyan/commit/fc5dc63))
- **integration:** Rebuild the Word template `1.2.0` to fix the settings dialog OK-button compile error
- **integration:** Clear inherited formatting and restore the caret after footnotes in the Word template
- **integration:** Align WPS add-in `1.1.1` field ranges, caret restore, and result clearing with the Word front end
- **integration:** Rebuild the Word template `1.2.0` binary after an erroneous push, restoring the intended build

### 📖 Documentation

- Merge style guidelines into tutorial and document two authoring workflows ([dd2baaf](https://github.com/jiaojiaodubai/banyan/commit/dd2baaf))
- Detail downloading the AI Style Workplace folder and supplying publisher format requirements ([e6448de](https://github.com/jiaojiaodubai/banyan/commit/e6448de))

### 🏡 Chore

- **typings:** Apply prettier formatting to style.d.ts ([ef11a8e](https://github.com/jiaojiaodubai/banyan/commit/ef11a8e))

### 🤖 CI

- Fix lint/test jobs - ignore pnpm-lock formatting and run node-only style-lint tests via mocha+tsx ([20a7394](https://github.com/jiaojiaodubai/banyan/commit/20a7394))

### ❤️ Contributors

- Jiaojiaodubai ([@jiaojiaodubai](https://github.com/jiaojiaodubai))

## v0.1.0 (2026-09-05)

### 🚀 Features

- CitedItemsSearch, citation column; enhance document lock ([6768c93](https://github.com/jiaojiaodubai/banyan/commit/6768c93))
- Add cslType support for itemType constraints in style components ([9bbe62a](https://github.com/jiaojiaodubai/banyan/commit/9bbe62a))
- Implement item retrieval with merge fallback and sync live item data for citations ([72febbe](https://github.com/jiaojiaodubai/banyan/commit/72febbe))
- Add formatDate utility ([6aac35a](https://github.com/jiaojiaodubai/banyan/commit/6aac35a))
- Enhance localization for inaccessible items; update style dialog button IDs ([354edd8](https://github.com/jiaojiaodubai/banyan/commit/354edd8))
- Enhance style component visibility; refactor style handling in bubble input; remove `/styles/list?includeUI=true` ([db681c5](https://github.com/jiaojiaodubai/banyan/commit/db681c5))

### 🩹 Fixes

- CslType type error; enhance: styleDialog focus behavior ([c5c336c](https://github.com/jiaojiaodubai/banyan/commit/c5c336c))

### 💅 Refactors

- Streamline style loading and ID handling; improve error logging ([0a186a9](https://github.com/jiaojiaodubai/banyan/commit/0a186a9))

### ❤️ Contributors

- Jiaojiaodubai ([@jiaojiaodubai](https://github.com/jiaojiaodubai))
