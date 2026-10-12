# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Banyan is a Zotero plugin that enables users to fully customize citation styles using JavaScript. Users write JavaScript style files that implement a specific interface, and the plugin executes these scripts in a sandboxed environment to generate citations and bibliographies.

**Key Concept**: User-authored JavaScript files define citation styles. The plugin loads these files from `<Zotero-data-dir>/banyan/`, evaluates them in a restricted sandbox, and calls their exported functions to generate formatted citations.

## Code Style

- Use `IOUtils` for file I/O, `PathUtils` for paths
- Use `ztoolkit.log()` / `ztoolkit.logError()` instead of `console.log` / `console.error`
- Resolve Zotero/Gecko host API types in this order: check `zotero-types` first, then confirm the latest behavior in `dev/Zotero-Source` if the types are missing or incomplete. After that, add or extend the declaration under `typings/` instead of using local `as` assertions. Organize the file to mirror `zotero-types` so the declaration can be contributed upstream later.
- Keep plugin-wide shared base types under `typings/` as well, including cross-module domain types such as `item`, `style`, `unit`, and `server`. Types used only inside one module should stay in that module, placed after imports and before file-level constants. `typings/style.d.ts` is the author-facing contract and is copied verbatim into the style editor and the AI style workplace by `pnpm gen:style-editor-dts`, so shapes only the plugin keeps (the style index, for example) belong in `typings/styleIndex.d.ts` instead.
- Compatibility helpers in `src/utils/compat` are only for confirmed API gaps between the latest stable Zotero release and the current beta target. Do not add compatibility branches for older releases, and do not introduce speculative compat code without source-level evidence.
- Two separate lint contexts:
  1. Main plugin code: [eslint.config.mjs](eslint.config.mjs)
  2. Style editor: [addon/content/styleEditor/eslint.config.mjs](addon/content/styleEditor/eslint.config.mjs)

- After finishing a session's code edit, always run `pnpm lint:fix` first (covers both contexts), then run `pnpm lint:check` to verify a clean result.
- Git hooks shared by contributors and agents run `pnpm test:dev` before commits and `pnpm test:release` before pushing `v*` release tags. `pnpm install` installs them without replacing existing hooks; see [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md). Do not bypass these checks without explicit user approval; CI independently enforces the release gate.

## References

- Zotero source code: `dev/Zotero-Source/` (especially `chrome/content/zotero/integration`)
- Zotero types: `node_modules/zotero-types/types/`
- Plugin toolkit: `node_modules/zotero-plugin-toolkit/`
- Copilot instructions (Chinese): `.github/copilot-instructions.md`
