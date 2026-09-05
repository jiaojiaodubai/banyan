#!/usr/bin/env node
/*
  Assemble the bundled integration add-ins from their source submodules into
  `addon/content/integration` before a build or release.

  - `integrations/Banyan-for-WPS`:
      Runs `npm ci` + `npm run build` (vite + copy). The produced
      `release/<Name>_<Version>/` bundle is synced into
      `addon/content/integration/WPS/`.
  - `integrations/Banyan-for-Word-VBA`:
      Ships a committed `Banyan.dotm`; copied as-is into
      `addon/content/integration/Word/`.

  Finally it regenerates the WPS add-in manifest
  (`scripts/genWPSAddinManifest.mjs`) from the synced bundle.

  Submodule working trees are fetched with
  `git submodule update --init --recursive` (CI checkout actions do this
  automatically). The WPS submodule does not commit a lockfile, so it installs
  with `npm install`; set `SKIP_WPS_INSTALL=1` to skip that step.
*/
import { execSync } from "node:child_process";
import { access, copyFile, cp, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const integrationsDir = path.join(rootDir, "integrations");
const wpsRepoDir = path.join(integrationsDir, "Banyan-for-WPS");
const wordRepoDir = path.join(integrationsDir, "Banyan-for-Word-VBA");
const wpsTargetRoot = path.join(
  rootDir,
  "addon",
  "content",
  "integration",
  "WPS",
);
const wordTargetDir = path.join(
  rootDir,
  "addon",
  "content",
  "integration",
  "Word",
);
function run(command, options = {}) {
  return execSync(command, { stdio: "inherit", shell: true, ...options });
}

function fail(message) {
  console.error(`[integrations:build] ${message}`);
  process.exit(1);
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function requireSubmodule(filePath, submodulePath, hint) {
  if (await exists(filePath)) return;
  fail(
    `${submodulePath} is not checked out (${hint}). Run ` +
      "`git submodule update --init --recursive` and try again.",
  );
}

function parseAddinDirName(dirName) {
  const separatorIndex = dirName.lastIndexOf("_");
  if (separatorIndex <= 0 || separatorIndex >= dirName.length - 1) {
    return null;
  }
  const name = dirName.slice(0, separatorIndex).trim();
  const version = dirName.slice(separatorIndex + 1).trim();
  if (!name || !/^\d+(\.\d+)*$/.test(version)) return null;
  return { dirName, name, version };
}

function compareVersionLike(a, b) {
  const aParts = String(a)
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map((part) => Number.parseInt(part, 10) || 0);
  const bParts = String(b)
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map((part) => Number.parseInt(part, 10) || 0);
  const maxLength = Math.max(aParts.length, bParts.length);
  for (let index = 0; index < maxLength; index += 1) {
    const av = aParts[index] ?? 0;
    const bv = bParts[index] ?? 0;
    if (av !== bv) return av - bv;
  }
  return String(a).localeCompare(String(b));
}

async function listAddinDirs(baseDir) {
  const entries = await readdir(baseDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => parseAddinDirName(entry.name))
    .filter((dir) => dir !== null);
}

async function buildWPS() {
  await requireSubmodule(
    path.join(wpsRepoDir, "package.json"),
    "integrations/Banyan-for-WPS",
    "missing package.json",
  );
  // vite.config.js imports this helper; upstream must track dev/ for a fresh
  // clone to be self-building (its .gitignore currently excludes it).
  if (!(await exists(path.join(wpsRepoDir, "dev", "vite-ui-build.js")))) {
    fail(
      "Banyan-for-WPS is not self-building: vite.config.js imports " +
        "`./dev/vite-ui-build.js` but the repo does not track its `dev/` " +
        "folder. Commit `dev/` in the Banyan-for-WPS repo (remove `dev` from " +
        "its .gitignore), then re-pin this submodule.",
    );
  }
  console.log("[integrations:build] Building WPS add-in submodule...");
  if (!process.env.SKIP_WPS_INSTALL) {
    run("npm install --no-audit --no-fund", { cwd: wpsRepoDir });
  }
  run("npm run build", { cwd: wpsRepoDir });

  const releaseDir = path.join(wpsRepoDir, "release");
  const builtDirs = await listAddinDirs(releaseDir);
  if (!builtDirs.length) {
    fail(`No '<Name>_<Version>' bundle found under ${releaseDir}.`);
  }
  builtDirs.sort((left, right) =>
    compareVersionLike(left.version, right.version),
  );
  const selected = builtDirs[builtDirs.length - 1];

  await mkdir(wpsTargetRoot, { recursive: true });
  const existing = await listAddinDirs(wpsTargetRoot);
  for (const entry of existing) {
    console.log(
      `[integrations:build] Removing outdated WPS bundle ${entry.dirName}`,
    );
    await rm(path.join(wpsTargetRoot, entry.dirName), {
      recursive: true,
      force: true,
    });
  }

  const sourceDir = path.join(releaseDir, selected.dirName);
  const targetDir = path.join(wpsTargetRoot, selected.dirName);
  await cp(sourceDir, targetDir, { recursive: true });
  console.log(
    `[integrations:build] Synced WPS bundle ${selected.dirName} -> ${path.relative(rootDir, targetDir)}`,
  );
}

async function buildWord() {
  await requireSubmodule(
    path.join(wordRepoDir, "Banyan.dotm"),
    "integrations/Banyan-for-Word-VBA",
    "missing committed Banyan.dotm",
  );
  await mkdir(wordTargetDir, { recursive: true });
  await copyFile(
    path.join(wordRepoDir, "Banyan.dotm"),
    path.join(wordTargetDir, "Banyan.dotm"),
  );
  console.log(
    `[integrations:build] Copied Word template -> ${path.relative(rootDir, path.join(wordTargetDir, "Banyan.dotm"))}`,
  );
}

async function main() {
  await buildWPS();
  await buildWord();
  console.log("[integrations:build] Regenerating WPS add-in manifest...");
  run("node scripts/genWPSAddinManifest.mjs", { cwd: rootDir });
  console.log("[integrations:build] Done.");
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
