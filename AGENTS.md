# AGENTS.md

Banyan is a Zotero plugin that lets users write JavaScript citation styles. The plugin loads
style files from `<Zotero-data-dir>/banyan/`, evaluates them in a restricted sandbox, and renders
citations and bibliographies. The style runtime is `@banyan/core`; the Zotero host integration
lives in this repository.

This file is a task index, not a rules manual. Read only the document(s) routed for the current
task. Detailed rules live in those documents so this file stays small and high-signal.

## Non-negotiables

- Every commit must independently pass `npx tsc --noEmit`, `pnpm lint:check`, `pnpm test:node`,
  `pnpm build`, and `pnpm test --no-watch`. Never validate only the final tip.
- Do not rewrite released history or move release tags. Before rewriting unreleased history,
  ask the user, stating both what will change and why; keep a backup and verify the final tree.
- Commit messages: short imperative subject (72 characters max), blank line, then a bullet body
  wrapped at 72 characters explaining what changed and why.
- For non-obvious architecture, API, or compatibility decisions, research the host source,
  official docs, and mature products; compare alternatives and record the decision before
  implementing.
- Keep commits atomic and the worktree clean; do not commit generated or untracked noise.

## Task routing

| If the task involves...                               | Read                                                                                                              |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Editing code (style, logging, types, lint)            | [CODING_CONVENTIONS.md](docs/CODING_CONVENTIONS.md)                                                               |
| Workflow, fix placement, commits, history, validation | [DEVELOPMENT_PRINCIPLES.md](docs/DEVELOPMENT_PRINCIPLES.md)                                                       |
| Zotero host/realm/window contracts                    | [HOST_OBLIGATIONS.md](docs/HOST_OBLIGATIONS.md); local case study: `dev/issues/STYLE-LIFECYCLE-LESSONS.md`        |
| Test strategy and real-GUI validation                 | [CONTRIBUTING.md §测试](docs/CONTRIBUTING.md#测试); local manual UI checks live in the untracked `dev/` workspace |
| Release, tags, submodules                             | [Release Workflow](docs/Release%20Workflow.MD)                                                                    |
| Persistent incident or architecture decision          | [INCIDENT-REVIEW.md](docs/templates/INCIDENT-REVIEW.md)                                                           |
| Maintaining AGENTS.md or adding agent rules           | [AGENTS_MAINTENANCE.md](docs/AGENTS_MAINTENANCE.md)                                                               |
| Style author contract, core, toolchain                | [Style Develop Tutorial](docs/Style%20Develop%20Tutorial.MD); `typings/`; `toolchain.lock.json`                   |
| Repository layout                                     | [CONTRIBUTING.md §代码归属](docs/CONTRIBUTING.md#代码归属)                                                        |

Read a routed document fully only when its task applies. Do not preload the whole repository
documentation before starting a task.

When a change is complete, use the Definition of Done in
[DEVELOPMENT_PRINCIPLES.md §10](docs/DEVELOPMENT_PRINCIPLES.md#10-definition-of-done).
