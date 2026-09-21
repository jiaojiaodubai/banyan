# Changelog

<!--
Maintained by `pnpm changelog` (changelogen). Before a release, edit this
"Unreleased" section as needed; `pnpm release` will then cut the version.
-->

## [Unreleased]

[compare changes](https://github.com/jiaojiaodubai/banyan/compare/v0.1.0...main)

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
