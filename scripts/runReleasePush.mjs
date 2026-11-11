import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function releaseTagForPush(input, version) {
  let releaseTag;
  for (const line of input.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const fields = line.trim().split(/\s+/);
    if (fields.length !== 4)
      throw new Error("Invalid pre-push reference record");
    const [localRef, localSha, remoteRef] = fields;
    if (
      localRef === "(delete)" ||
      /^0+$/.test(localSha) ||
      !remoteRef.startsWith("refs/tags/v")
    )
      continue;
    const tag = remoteRef.slice("refs/tags/".length);
    if (tag !== `v${version}`)
      throw new Error(
        `Release tag ${tag} does not match package version ${version}`,
      );
    releaseTag = tag;
  }
  return releaseTag;
}

async function main() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const { version } = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  );
  const tag = releaseTagForPush(input, version);
  if (!tag) return;
  process.stdout.write(`Testing release tag ${tag} before push.\n`);
  const result = spawnSync("pnpm test:release", {
    cwd: root,
    env: { ...process.env, BANYAN_RELEASE_TAG: tag },
    stdio: "inherit",
    shell: true,
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
