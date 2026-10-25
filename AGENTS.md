# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

Banyan is a Zotero plugin that enables users to fully customize citation styles using JavaScript. Users write JavaScript style files that implement a specific interface, and the plugin executes these scripts in a sandboxed environment to generate citations and bibliographies.

**Key Concept**: User-authored JavaScript files define citation styles. The plugin loads these files from `<Zotero-data-dir>/banyan/`, evaluates them in a restricted sandbox, and calls their exported functions to generate formatted citations.

## Code Style

- Use `IOUtils` for file I/O, `PathUtils` for paths
- Log through the scoped logger: `const log = createLogger("<module>")` from `src/utils/logger`, then `log.debug/info/warn/error`. Never `console.log` / `console.error`, and no raw `ztoolkit.log`. `debug`/`info` go to Zotero's debug output, `warn`/`error` also to its error console; pass the `Error` as the second argument so its stack survives.
- Resolve Zotero/Gecko host API types in this order: check `zotero-types` first, then confirm the latest behavior in `dev/Zotero-Source` if the types are missing or incomplete. After that, add or extend the declaration under `typings/` instead of using local `as` assertions. Organize the file to mirror `zotero-types` so the declaration can be contributed upstream later.
- Keep plugin-wide shared base types under `typings/` as well, including cross-module domain types such as `server` and the style index. Types used only inside one module should stay in that module, placed after imports and before file-level constants. The author contract is owned by the core: `typings/{item,style,styleUtils,unit}.d.ts` only re-export `@banyan/core/types/*`, and `pnpm gen:style-editor-dts` generates the editor and AI-workplace copies from the core's `src/types/`, so shapes only the plugin keeps (the style index, for example) belong in `typings/styleIndex.d.ts`.
- Compatibility helpers in `src/utils/compat` are only for confirmed API gaps between the latest stable Zotero release and the current beta target. Do not add compatibility branches for older releases, and do not introduce speculative compat code without source-level evidence.
- When checking Zotero API compatibility, compare the latest stable release tag and the live `origin/main` branch in `dev/Zotero-Source` with Git object commands. Ignore all local working-tree changes there; the directory contains submodule-related files that do not represent the upstream API baseline.
- Three lint/typecheck areas, each with its own command:
  1. Main plugin code: [eslint.config.mjs](eslint.config.mjs) → `pnpm lint:main` / `pnpm lint:fix:main`
  2. Style editor: [addon/content/styleEditor/eslint.config.mjs](addon/content/styleEditor/eslint.config.mjs) → `pnpm lint:style-editor` / `pnpm lint:fix:style-editor`
  3. Test projects: [test/tsconfig.json](test/tsconfig.json) and [tests-node/tsconfig.json](tests-node/tsconfig.json) → `pnpm typecheck:tests`
- `@banyan/core` and the style author rules come from one published toolchain revision recorded in `toolchain.lock.json`: the dependencies install its release tarballs, and `addon/content/styleEditor/eslint-plugin-banyan-style.mjs` plus `eslint-plugin-banyan-style.build.json` are generated copies. To change the core or the rules, edit the Banyan Toolchain, publish a revision, update the dependencies and lock, then run `pnpm gen:style-lint`. `pnpm lint:check` runs `pnpm check:style-lint` to catch drift.
- After finishing a session's code edit, always run `pnpm lint:fix` first (covers the two eslint areas), then run `pnpm lint:check` (which also typechecks the test projects) to verify a clean result.

## References

- Zotero source code: `dev/Zotero-Source/` (especially `chrome/content/zotero/integration`)
- Zotero types: `node_modules/zotero-types/types/`
- Plugin toolkit: `node_modules/zotero-plugin-toolkit/`
- Copilot instructions (Chinese): `.github/copilot-instructions.md`
