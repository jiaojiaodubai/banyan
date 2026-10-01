# Banyan (榕树)

[简体中文](README.md) | English

[![CI](https://github.com/jiaojiaodubai/Banyan/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/jiaojiaodubai/Banyan/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/jiaojiaodubai/Banyan?include_prereleases&style=flat-square&label=release)](https://github.com/jiaojiaodubai/Banyan/releases)
[![License](https://img.shields.io/github/license/jiaojiaodubai/Banyan?style=flat-square)](LICENSE)
[![Downloads](https://img.shields.io/github/downloads/jiaojiaodubai/Banyan/total?style=flat-square)](https://github.com/jiaojiaodubai/Banyan/releases)
[![Zotero](https://img.shields.io/badge/Zotero-8%E2%80%9310-CC2936?style=flat-square&logo=zotero&logoColor=white)](https://www.zotero.org/)
[![Front ends](https://img.shields.io/badge/front--end-Word%20%7C%20WPS-2B579A?style=flat-square)](#install-a-word-processor-front-end)
[![Stars](https://img.shields.io/github/stars/jiaojiaodubai/Banyan?style=flat-square&logo=github)](https://github.com/jiaojiaodubai/Banyan/stargazers)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square)](#contributing)
[![Using Zotero Plugin Template](https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=flat-square&logo=github)](https://github.com/windingwind/zotero-plugin-template)

## Table of Contents

- [Introduction](#introduction)
- [Features](#features)
- [Usage](#usage)
  - [Install the plugin](#install-the-plugin)
  - [Install a word-processor front end](#install-a-word-processor-front-end)
  - [Writing workflow](#writing-workflow)
  - [Write & install styles](#write--install-styles)
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

The plugin does the “thinking”; the word processor does the “writing”. The two
talk over local HTTP. Two front ends exist today, and more clients can be added
later:

| Front end                                                               | Host application     | Platforms             | Features                                                                                                                                            |
| ----------------------------------------------------------------------- | -------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Banyan for Word](https://github.com/jiaojiaodubai/Banyan-for-Word-VBA) | Microsoft Word 2016+ | Windows, macOS        | Insert/Edit Citation, Insert Break, Insert/Edit Bibliography, Refresh, Convert Zotero Fields, Finalize, Preferences                                 |
| [Banyan for WPS](https://github.com/jiaojiaodubai/Banyan-for-WPS)       | WPS Writer 2019+     | Windows, macOS, Linux | Insert/Edit Citation, Insert Break, Insert/Edit Bibliography, Open Citation Pane, Refresh, Convert Zotero Fields, Finalize, Preferences, Dark Theme |

Front ends are **released in lockstep** with the plugin, so install or uninstall
them from **Zotero settings → Banyan → Add-ins**:

- **Close the host application first** (Word or WPS) when installing or
  uninstalling, then start it again for the change to take effect.
- **While using it**, keep Zotero running with the Banyan plugin enabled.
- **On first use** the host application asks for authorization (Word may also
  ask to enable macros/content, and on macOS you must trust the local HTTPS
  certificate); approve the prompts to continue.

### Writing workflow

1. In the word processor (e.g. Word/WPS), place the cursor where the citation
   goes and click **Insert Citation**.
2. Pick a style and items; the citation is inserted. When done, use
   **Refresh** to renumber and **Insert Bibliography** to generate the
   reference list.
3. Before submission use **Convert/Finalize** to replace Banyan fields with
   plain text (finalize backs up first).

### Write & install styles

A Banyan style is a JavaScript file that implements a fixed interface (interface
spec and tutorial: [Style Develop Tutorial](docs/Style%20Develop%20Tutorial.MD)).
Writing and installing are two separate steps: produce the file with either
workflow below, then follow
[How to install a style](#how-to-install-a-style).

**Workflow 1 — Hand-written**, for users with JavaScript experience.

1. Use the built-in style editor (recommended): open it via the Zotero menu
   **Tools → Banyan Style Editor**. It is a full coding environment with **type
   hints, preset templates & code snippets, code checking & formatting, and
   output preview**; “Save As Style” indexes the style right away, so **no manual
   installation is needed**.
2. Or use the editor you prefer: write a `.js` file (the type declarations under
   `docs/AI Style Workplace/typings` provide completion and checking).

**Workflow 2 — AI-assisted**, for users without coding experience.

1. Download the
   [`docs/AI Style Workplace`](docs/AI%20Style%20Workplace/Style%20AI%20Authoring%20Guidelines.MD)
   folder from this repository (it contains type declarations and authoring
   rules written for AI agents).
   > Don't know how to download?
   >
   > - **Easiest — download the whole repo**: open the repository homepage
   >   [github.com/jiaojiaodubai/Banyan](https://github.com/jiaojiaodubai/Banyan), click the
   >   green **Code** button → **Download ZIP**, and unzip the archive; open the
   >   `docs/AI Style Workplace/` folder inside — that is all you need (ignore the rest).
   > - **Download just this folder**: open the
   >   [`docs/AI Style Workplace`](https://github.com/jiaojiaodubai/Banyan/tree/main/docs/AI%20Style%20Workplace)
   >   directory page, copy the URL from the address bar, and paste it into a
   >   directory-download service such as [DownGit](https://minhaskamal.github.io/DownGit)
   >   to pack and download only that folder.
2. Set that folder as the working directory of an AI agent (e.g. Claude Code,
   Codex, GitHub Copilot) and also prepare the formatting requirements you have
   at hand:
   - Publishers or schools usually provide citation/bibliography requirements as
     **online web pages** or office documents such as **`.pdf`/`.docx`**.
   - If the requirements are on a **web page**, simply send the link to the agent;
     if they are provided as **`.pdf`/`.docx` files**, drop the files into this
     working directory and tell the agent where they are — it will generate the
     style from both the document and the bundled rules.
3. Describe your formatting requirements (citation/bibliography style, journal
   or school rules, etc.). The agent generates the `.js` style from the bundled
   types and rules.

#### How to install a style

Any one of the following works; installed styles are indexed by the plugin and
listed in the “Choose Style” dialog:

- **Save from the built-in editor (no manual install)**: “Save” in the style
  editor writes the file straight into the plugin's style folder, ready to use.
- **Import via the style manager**: **Zotero settings → Banyan → Style manager →
  Import Style** and pick the `.js` file; the **Import** button in the “Choose
  Style” dialog does the same. A duplicate style ID prompts to overwrite.
- **Copy the file manually**: drop the `.js` into the `banyan/` folder inside
  your Zotero data directory (locate it via **Zotero settings → Advanced → Files
  and Folders → Show Data Directory**); `banyan/` is created on first run. A
  style is indexed by the `INFO.id` inside the file, so the file name does not
  matter.

## Contributing

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
