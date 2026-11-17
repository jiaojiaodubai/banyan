#!/usr/bin/env node
/**
 * Guard AGENTS.md so it stays a small, valid task index.
 *
 * Checks:
 * - size ceiling;
 * - required section headings;
 * - every local Markdown link resolves to a real file;
 * - CLAUDE.md remains a pointer to AGENTS.md.
 *
 * Run with `pnpm check:agents` (included in `pnpm lint:check` and CI).
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const AGENTS_FILE = resolve(ROOT, "AGENTS.md");
const CLAUDE_FILE = resolve(ROOT, "CLAUDE.md");
const MAX_LINES = 80;

const errors = [];

function fail(message) {
  errors.push(message);
}

function readRequired(path, label) {
  if (!existsSync(path)) {
    fail(`${label} is missing: ${path}`);
    return "";
  }
  return readFileSync(path, "utf8");
}

const agents = readRequired(AGENTS_FILE, "AGENTS.md");
const claude = readRequired(CLAUDE_FILE, "CLAUDE.md");

if (agents) {
  const lines = agents.split(/\r?\n/).length;
  if (lines > MAX_LINES) {
    fail(
      `AGENTS.md has ${lines} lines (limit ${MAX_LINES}). Move details into docs/ and keep only a route.`,
    );
  }

  for (const heading of ["## Non-negotiables", "## Task routing"]) {
    if (!agents.includes(heading)) {
      fail(`AGENTS.md is missing required heading: ${heading}`);
    }
  }

  const linkPattern = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  for (const match of agents.matchAll(linkPattern)) {
    const target = match[1];
    if (/^(?:https?:|mailto:|#)/i.test(target)) continue;
    if (/^[a-zA-Z]:[\\/]|^\//.test(target)) {
      fail(`AGENTS.md link must be repository-relative: ${target}`);
      continue;
    }
    const withoutFragment = decodeURIComponent(target.split("#")[0]);
    const absolute = resolve(ROOT, withoutFragment);
    if (!existsSync(absolute) || !statSync(absolute).isFile()) {
      fail(`AGENTS.md link does not resolve: ${target}`);
    }
  }
}

if (claude && !claude.includes("AGENTS.md")) {
  fail("CLAUDE.md must point to AGENTS.md instead of duplicating rules");
}

if (errors.length) {
  console.error("check:agents failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

const lineCount = agents.split(/\r?\n/).length;
console.log(`check:agents passed (${lineCount}/${MAX_LINES} lines)`);
