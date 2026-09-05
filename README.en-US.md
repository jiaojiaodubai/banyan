# Banyan (榕树)

[简体中文](README.md) | English

[![Using Zotero Plugin Template](https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=flat-square&logo=github)](https://github.com/windingwind/zotero-plugin-template)

> This project was created from the
> [zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template)
> and keeps the badge above as the template requests; the code inherits its GNU
> AGPL license (see [License](#license)).

## Table of Contents

- [Introduction](#introduction)
- [Features](#features)
- [Usage](#usage)
  - [Install the plugin](#install-the-plugin)
  - [Install a word-processor front end](#install-a-word-processor-front-end)
  - [Writing workflow](#writing-workflow)
  - [Use your own styles](#use-your-own-styles)
- [Contributing](#contributing)
  - [Environment](#environment)
  - [Clone & prepare](#clone--prepare)
  - [Development](#development)
  - [Testing](#testing)
  - [Release](#release)
- [License](#license)

## Introduction

Banyan (榕树) is a citation **backend** plugin for
[Zotero](https://www.zotero.org/): **fully customize citation styles with
JavaScript**, and expose citation capabilities to external clients over a local
HTTP service.

> **Why “Banyan”?**
> In southern China a banyan tree drops aerial roots from its branches; once
> they reach the ground they take root and grow into new trunks, until one tree
> becomes a forest. We hope the literature you cite in your paper grows just
> like those aerial roots—naturally from the branch of an argument and firmly
> rooted in solid ground—so every claim points clearly to its source and the
> whole “tree of your paper” stays lush and well-grounded.

## Features

- **Styles as code**: every style is a JavaScript file implementing the
  `Style` interface—title case, name abbreviation, ibid detection, dates,
  multi-language handling, etc. are all up to you.
- **Works out of the box**: ships with several preset styles that you can
  import/manage from the preferences pane, plus a built-in style editor with
  live preview.
- **Backend-first**: the plugin itself is a citation backend serving external
  clients over local HTTP (default port `23119`); a **word processor** is just
  one kind of front end, and is not limited to any single product.
- UI available in 简体中文 / English.

## Usage

### Install the plugin

1. Download the latest `banyan-*.xpi` from
   [Releases](https://github.com/jiaojiaodubai/Banyan/releases) (`.xpi` is the
   stable build; `-beta` is a preview).
2. In Zotero open **Tools → Add-ons → gear icon → Install Add-on From File…**,
   select the downloaded `.xpi`, then restart Zotero.
3. Manage styles and add-ins under **Zotero settings → Banyan**.

### Install a word-processor front end

The plugin does the “thinking”; the word processor does the “writing”. A
word-processor front end talks to this plugin (the backend) over local HTTP.
Currently Microsoft Word and WPS Office are implemented, and more clients can
be added later:

| Front end  | Purpose                                         | Repository                                                                                |
| ---------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Word (VBA) | Insert/refresh citations & bibliography in Word | [jiaojiaodubai/Banyan-for-Word-VBA](https://github.com/jiaojiaodubai/Banyan-for-Word-VBA) |
| WPS        | Insert/refresh citations & bibliography in WPS  | [jiaojiaodubai/Banyan-for-WPS](https://github.com/jiaojiaodubai/Banyan-for-WPS)           |

It is recommended to install/uninstall from the **Add-ins** section of the
plugin preferences (front ends are **released in lockstep** with the plugin, so
the matching version is installed automatically):

- **Word**: one-click install copies `Banyan.dotm` into Word's STARTUP folder;
  restart Word and enable macros/content if prompted, then use the ribbon under
  **Home → Banyan**. Manual installation is also documented in that repo's
  README.
- **WPS**: installs into WPS's add-in folder; restart WPS and approve the
  prompt to enable it.
- Keep Zotero (the backend) running while using a front end; on first use you
  may be asked to trust the client.

### Writing workflow

1. In the word processor (e.g. Word/WPS), place the cursor where the citation
   goes and click **Insert Citation**.
2. Pick a style and items; the citation is inserted. When done, use
   **Refresh** to renumber and **Insert Bibliography** to generate the
   reference list.
3. Before submission use **Convert/Finalize** to replace Banyan fields with
   plain text (finalize backs up first).

### Use your own styles

A Banyan style is a JavaScript file that implements a fixed interface (interface
spec and tutorial: [Style Develop Tutorial](docs/Style%20Develop%20Tutorial.MD)).
Two authoring workflows are designed for different backgrounds:

**Workflow 1 — Hand-written**, for users with JavaScript experience.

1. Use the built-in style editor (recommended): open it via the Zotero menu
   **Tools → Banyan Style Editor**. It is a full coding environment with **type
   hints, preset templates & code snippets, code checking & formatting, and
   output preview**; “Save As Style” indexes it right away.
2. Or use the editor you prefer: save your `.js` style into the `banyan/` folder
   under your Zotero data directory (the plugin data folder—locate it via
   **Zotero settings → Advanced → Files and Folders → Show Data Directory**).
   Styles there are indexed automatically on startup and listed in the citation
   dialog.

**Workflow 2 — AI-assisted**, for users without coding experience.

1. Download the
   [`docs/AI Style Workplace`](docs/AI%20Style%20Workplace/Style%20AI%20Authoring%20Guidelines.MD)
   folder from this repository (it contains type declarations and authoring
   rules written for AI agents).
2. Set that folder as the working directory of an AI agent (e.g. Claude Code,
   Codex, GitHub Copilot).
3. Describe your formatting requirements (citation/bibliography style, journal
   or school rules, etc.). The agent generates the `.js` style from the bundled
   types and rules; drop the generated file into the `banyan/` data folder and
   it is ready to use.

The plugin skeleton comes from the
[zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template);
the develop/build/release flow is powered by
[zotero-plugin-scaffold](https://github.com/northword/zotero-plugin-scaffold),
Zotero API typings come from [zotero-types](https://github.com/windingwind/zotero-types),
and UI helpers come from
[zotero-plugin-toolkit](https://github.com/windingwind/zotero-plugin-toolkit).

### Environment

- Node.js ≥ 20 and [pnpm](https://pnpm.io/)
- A [Zotero](https://www.zotero.org/download/) install (for local development;
  use the latest stable build)
- Git (submodules host the word-processor front-end sources)

### Clone & prepare

```powershell
git clone https://github.com/jiaojiaodubai/Banyan.git
cd Banyan
pnpm install                 # install repo dependencies
git submodule update --init --recursive   # or: pnpm submodules:init
pnpm integrations:build     # assemble addon/content/integration from submodules
```

`integrations/` holds read-only build inputs (submodules);
`addon/content/integration/` artifacts are **never committed**—they are
generated by `integrations:build`.

### Development

```powershell
pnpm start        # build & launch Zotero (zotero-plugin serve), hot reload on change
pnpm build        # validation: build + tsc --noEmit
pnpm lint:fix     # prettier + eslint (incl. styleEditor) auto-fix
pnpm lint:check   # verify formatting & rules
```

For code conventions and structure see `AGENTS.md` (and
`.github/copilot-instructions.md`): prefer small pure functions, public API in
`src/modules`, utilities in `src/utils`, and cross-module base types in
`typings/`.

### Testing

```powershell
pnpm test          # mocha unit tests that run inside Zotero (zotero-plugin test)
pnpm test:node     # Node-only tests (style lint rules, mocha + tsx)
```

When changing a word-processor front end, develop and self-test in its own repo:

- Banyan-for-WPS: `npm install && npm run build`
- Banyan-for-Word-VBA: see `test/Run-Tests.ps1` / `Import-BanyanDotm.ps1`

### Release

Releases use a “bump locally → publish in CI” two-phase flow (details in
[Release Workflow](docs/Release%20Workflow.MD)):

```powershell
pnpm release:prepare   # update deps/submodules → assemble front ends → build → refresh CHANGELOG
# review `git status` / CHANGELOG.md, then:
pnpm release           # pick the version: auto commit + tag + push
```

After pushing a `v**` tag, CI (`.github/workflows/release.yml`) assembles the
word-processor front ends from the locked submodule commits, builds, and
publishes the XPI plus update manifests to the GitHub Release.

## License

Derived from the
[zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template)
and licensed under its GNU AGPL as required; this repository's code is
distributed under [AGPL-3.0-or-later](LICENSE) without warranty.
