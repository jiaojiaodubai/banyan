import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Repository root, resolved from this file rather than the process cwd. */
export const repoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

export const fixturesDir = join(repoRoot, "test-gui");
export const fixturesPath = join(fixturesDir, "fixtures.json");
export const stylesDir = join(fixturesDir, "styles");
export const stateDir = join(fixturesDir, ".state");

export function repoPath(...parts: string[]): string {
  return join(repoRoot, ...parts);
}

export async function ensureRuntimeDirs(): Promise<void> {
  await mkdir(stateDir, { recursive: true });
}
