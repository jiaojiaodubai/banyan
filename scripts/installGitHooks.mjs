import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { chmod, copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hookNames = ["pre-commit", "pre-push"];

export async function installGitHook(target, hookSource) {
  await mkdir(path.dirname(target), { recursive: true });
  try {
    await copyFile(hookSource, target, constants.COPYFILE_EXCL);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    if (!(await readFile(target)).equals(await readFile(hookSource)))
      return false;
  }
  await chmod(target, 0o755);
  return true;
}

async function main() {
  if (process.env.CI) return;
  const options = { cwd: root, encoding: "utf8" };
  const customPath = spawnSync(
    "git",
    ["config", "--get", "core.hooksPath"],
    options,
  );
  if (customPath.status === 0 && customPath.stdout.trim()) {
    if (
      path.resolve(root, customPath.stdout.trim()) ===
      path.join(root, ".githooks")
    ) {
      for (const name of hookNames)
        await chmod(path.join(root, ".githooks", name), 0o755);
      process.stdout.write("Using the repository's .githooks directory.\n");
    } else {
      process.stderr.write(
        "Custom core.hooksPath detected; integrate the repository's pre-commit and pre-push hooks manually.\n",
      );
    }
    return;
  }
  for (const name of hookNames) {
    const git = spawnSync(
      "git",
      ["rev-parse", "--git-path", `hooks/${name}`],
      options,
    );
    if (git.status !== 0 || !git.stdout.trim()) {
      process.stderr.write(
        "Git hooks unavailable; install them when a Git checkout is available.\n",
      );
      return;
    }
    const target = path.resolve(root, git.stdout.trim());
    if (await installGitHook(target, path.join(root, ".githooks", name))) {
      process.stdout.write(`Installed ${name} test hook: ${target}\n`);
    } else {
      process.stderr.write(
        `Existing hook preserved: ${target}. Integrate .githooks/${name} manually.\n`,
      );
    }
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
