# Changelog

<!--
Maintained by `pnpm changelog` (changelogen). Before a release, edit this
"Unreleased" section as needed; `pnpm release` will then cut the version.
-->

## Unreleased

### 🚀 Enhancements

- **field presets:** Styles can declare an `ITEM_FIELD_PRESETS` array to add "Quick Marks" to the item context menu; applying a mark writes its declared key/value pairs onto the selected items — as real fields when the key is valid for the item type, otherwise as `extra` lines
- A mark can leave a value to the user by declaring `null`: applying it opens the write dialog with the key fixed and asks for the value
- Only one style feeds the menu at a time, chosen in the preferences (by default the style last used for rendering)
- Conflicting values are never overwritten silently: applying a mark asks whether to skip or overwrite, with an option to apply the answer to the remaining items
- **field validation:** Styles can declare an `ITEM_FIELD_VALIDATORS` object to add "Check Fields" to the item context menu; checks may be synchronous or async (10-second per-check timeout), run on each selected editable item, and open a non-modal report tree grouped by item, showing every checker's description and result
- Only one style feeds the item menu at a time; quick marks and field checks share the same style preference
- **style chooser:** When no style is supplied, preselect the style chosen for the item menu (or the last used style) before falling back to the first entry
- **style chooser:** Show the selected style's title, citation type, update date, description and global options in a resizable details pane; the splitter is keyboard-operable, and Cancel returns no selection
- **style options:** Styles declare `STYLE_OPTIONS` for document-wide options; `generate()` receives the values through the readonly global `options`. The core resolves effective values, while the settings UI and automation retain the stored values.
- **style editor:** Preview a style's global options and the last run's sandbox findings beside the output; trace lines stay in their own console section
- **parameters:** `CITATION_PARAMS` / `CITE_PARAMS` describe author inputs as `state` (boolean or `states` enum), `value` (plain or rich markup string) or `list` (repeated value fields). `defaultValue`, `applicable`, `forcedValue` and `validate` cover defaults, applicability, locked values and free-value checks without exposing widgets.
- The core resolves all three scopes before `generate()`; hidden values fall back to `defaultValue`, forced values are read-only, and `citation.source` preserves stored values instead of writing defaults back.
- **item list:** Show one `extra` key's value as its own item-list column, chosen in a new "Item list" section of the preferences (the column appears in Zotero's column settings once a key is set)

### 🩹 Fixes

- **extra field:** Keep key/value lines at the top of `extra` and sort them by key, as Zotero's own documentation requires and citeproc reads them contiguously
- **controls:** Align native Zotero inputs and menus with their labels; match rich-text previews to native input dimensions; open rich-text editing from the preview; keep list controls on one line with inline labels and native add/remove buttons; size the cite popup to its content; show descriptions in tooltips
- **validation:** Block citation confirmation as soon as a citation or cite parameter is invalid, mark the offending bubble/field, and show errors in a dialog that focuses the first invalid control instead of reserving lines under controls
- **rich-text dialog:** Use the shared dialog footer metrics and button order, unify the heading and inner padding, and mark the confirm button as the default action
- **style editor:** Wrap long lint/error lines and keep their containers within the output pane; wrap the copied runtime-error text instead of scrolling horizontally
- **bibliography:** Match the uncited-items tree's icon/title spacing to Zotero's item tree
- **debug:** Open the citation and bibliography dialogs with the last used style instead of the alphabetically first style, so a style without cite parameters does not produce an empty cite popup during manual checks

### 💅 Styles

- **breaking:** Style inputs use `STYLE_OPTIONS` / `CITATION_PARAMS` / `CITE_PARAMS`. Each entry declares `kind: "state" | "value" | "list"` with `defaultValue`, and optional `applicable` / `forcedValue` / `validate`; no compatibility aliases are kept.
- **breaking:** rich parameter values are restricted markup strings with `format: "rich"`; `list` rows contain string fields only.
- **breaking:** Keys of `item.extra` follow Zotero's own variable-line syntax now, so lines such as `tex.shorttitle: Foo` or `see:` stay prose and are no longer read as keys
- **breaking:** Item identity is the opaque string `id`; `key`, `uri` and `relations` are no longer exposed to styles, and the durable reference is the host-private `z:uri` extension key
- **preferences:** Give each setting a separate heading and place its description below the heading, avoiding crowded labels
- The style editor validates `ITEM_FIELD_PRESETS` (`banyanStyle/validate-field-presets`) and `ITEM_FIELD_VALIDATORS` (`banyanStyle/validate-item-field-validators`)

### 💅 Refactors

- **core:** Extract the host-agnostic style runtime into `@banyan/core`; the plugin now supplies the Gecko sandbox, the three host capabilities and item conversion, while the core owns loading, parameters, output normalization and diagnostics
- **comments:** Remove stale, scaffold-style and prompt-style comments across the sandbox, dialogs and preferences; drop the unused `exportHostObject` helper and refresh the core-extraction notes

### ✅ Tests

- Add `test/sandboxHost.test.ts` to cover the Gecko host adapter: host-global isolation, readonly contexts, utility/console replacement, HTML parsing, file boundaries, validator/list provenance, generate timeouts, diagnostics and binary bridging
- Prefix style findings with `[style=<id> / <title>]` so batch `style-load` problems can be traced back to a file
- Remove the tracked manual GUI checklist, browser harness, generated test narratives and pre-push gate; keep the Local API fixture set and injection tooling, now public under `test-gui/`

### 📖 Documentation

- Add `docs/CONTRIBUTING.md` for environment setup, directory ownership, engineering constraints, test layers and release instructions; link it from both READMEs
- Move the GUI acceptance document, fixtures and injection tooling to `test-gui/`; replace local core references with links to the published core repository and keep the document as a status-free test specification for both humans and agents. Move the host obligations mapping to `docs/HOST_OBLIGATIONS.md`

## v0.4.0 (2026-10-07)

[compare changes](https://github.com/jiaojiaodubai/banyan/compare/v0.3.0...v0.4.0)

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
