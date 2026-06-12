import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const wpsRootDir = path.join(rootDir, "addon", "content", "integration", "WPS");
const outputJSONPath = path.join(wpsRootDir, "addin-manifest.json");

function parseAddinDirName(dirName) {
  const separatorIndex = dirName.lastIndexOf("_");
  if (separatorIndex <= 0 || separatorIndex >= dirName.length - 1) {
    return null;
  }

  const name = dirName.slice(0, separatorIndex).trim();
  const version = dirName.slice(separatorIndex + 1).trim();
  if (!name || !version) {
    return null;
  }

  return {
    dirName,
    name,
    version,
  };
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
    if (av !== bv) {
      return av - bv;
    }
  }

  return String(a).localeCompare(String(b));
}

async function findTargetAddinDirectory() {
  const entries = await readdir(wpsRootDir, { withFileTypes: true });
  const parsedDirs = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => parseAddinDirName(entry.name))
    .filter((entry) => entry !== null);

  if (!parsedDirs.length) {
    throw new Error(
      `No WPS add-in directory found under ${wpsRootDir}. Expected '<name>_<version>' format.`,
    );
  }

  if (parsedDirs.length === 1) {
    return parsedDirs[0];
  }

  const addonNames = new Set(parsedDirs.map((entry) => entry.name));
  if (addonNames.size > 1) {
    throw new Error(
      `Multiple WPS add-in names detected under ${wpsRootDir}: ${Array.from(addonNames).join(", ")}. Keep only one add-in name.`,
    );
  }

  const sorted = [...parsedDirs].sort((left, right) =>
    compareVersionLike(left.version, right.version),
  );
  const selected = sorted[sorted.length - 1];

  console.warn(
    `[gen:wps-addin-manifest] Multiple versions detected; using latest '${selected.dirName}'.`,
  );
  return selected;
}

async function collectRelativeFiles(baseDir, relativeDir = "") {
  const currentDir = path.join(baseDir, relativeDir);
  const entries = await readdir(currentDir, { withFileTypes: true });
  const sortedEntries = [...entries].sort((left, right) =>
    left.name.localeCompare(right.name),
  );

  const files = [];
  for (const entry of sortedEntries) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    const nextRelative = relativeDir
      ? path.posix.join(relativeDir, entry.name)
      : entry.name;

    if (entry.isDirectory()) {
      files.push(...(await collectRelativeFiles(baseDir, nextRelative)));
      continue;
    }

    if (entry.isFile()) {
      files.push(nextRelative.replace(/\\/g, "/"));
    }
  }

  return files;
}

async function main() {
  const target = await findTargetAddinDirectory();
  const addinDir = path.join(wpsRootDir, target.dirName);
  const files = await collectRelativeFiles(addinDir);

  if (!files.length) {
    throw new Error(`No files found in ${addinDir}.`);
  }

  const manifest = {
    name: target.name,
    version: target.version,
    type: "wps",
    resourceRoot: `integration/WPS/${target.dirName}`,
    files,
  };

  await writeFile(
    outputJSONPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  console.log(
    `[gen:wps-addin-manifest] Generated ${path.relative(rootDir, outputJSONPath)} with ${files.length} files from ${target.dirName}.`,
  );
}

main().catch((error) => {
  console.error("[gen:wps-addin-manifest] Failed:", error);
  process.exitCode = 1;
});
