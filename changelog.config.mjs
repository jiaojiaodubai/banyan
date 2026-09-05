/**
 * Shared conventional-commit groups for the release changelog.
 *
 * Used by both:
 * - `pnpm changelog` (changelogen) to maintain `CHANGELOG.md`, and
 * - zotero-plugin-scaffold's `release` (it loads this file through changelogen
 *   and merges its own `add`/`change`/`remove` overrides on top).
 *
 * Commit prefixes follow conventional commits (`feat`, `fix`, ...); the plugin
 * codebase also historically uses Zotero-style `add`/`change`/`remove`.
 */
export default {
  types: {
    feat: { title: "🚀 Features", semver: "minor" },
    add: { title: "🚀 Enhancements", semver: "minor" },
    fix: { title: "🩹 Fixes", semver: "patch" },
    change: { title: "🩹 Fixes", semver: "patch" },
    remove: { title: "🩹 Fixes", semver: "minor" },
    perf: { title: "🔥 Performance", semver: "patch" },
    refactor: { title: "💅 Refactors", semver: "patch" },
    docs: { title: "📖 Documentation", semver: "patch" },
    build: { title: "📦 Build", semver: "patch" },
    test: { title: "✅ Tests" },
    ci: { title: "🤖 CI" },
    style: { title: "🎨 Styles" },
    chore: { title: "🏡 Chore" },
  },
  noAuthors: false,
  output: "CHANGELOG.md",
};
