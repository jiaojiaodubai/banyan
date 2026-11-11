import { assert } from "chai";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installGitHook } from "../scripts/installGitHooks.mjs";
import { releaseTagForPush } from "../scripts/runReleasePush.mjs";
import { version } from "../package.json";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sha = "a".repeat(40);
const zeros = "0".repeat(40);

describe("Git hooks", function () {
  describe("pre-commit hook installation", function () {
    let directory: string;

    beforeEach(async function () {
      directory = await mkdtemp(path.join(os.tmpdir(), "banyan-hook-test-"));
    });

    afterEach(async function () {
      await rm(directory, { recursive: true, force: true });
    });

    it("installs the hook and is idempotent", async function () {
      const target = path.join(directory, "hooks", "pre-commit");
      const source = path.join(root, ".githooks", "pre-commit");
      assert.isTrue(await installGitHook(target, source));
      assert.isTrue(await installGitHook(target, source));
      assert.include(await readFile(target, "utf8"), "pnpm test:dev");
    });

    it("does not replace an existing hook", async function () {
      const target = path.join(directory, "pre-commit");
      await writeFile(target, "existing hook");
      assert.isFalse(
        await installGitHook(
          target,
          path.join(root, ".githooks", "pre-commit"),
        ),
      );
      assert.strictEqual(await readFile(target, "utf8"), "existing hook");
    });
  });

  describe("release push selection", function () {
    it("ignores ordinary branches and deleted tags", function () {
      const input = `refs/heads/main ${sha} refs/heads/main ${zeros}\n(delete) ${zeros} refs/tags/v1.0.0 ${sha}\n`;
      assert.isUndefined(releaseTagForPush(input, "1.0.0"));
    });

    it("selects a matching release tag", function () {
      assert.strictEqual(
        releaseTagForPush(
          `refs/tags/v1.0.0 ${sha} refs/tags/v1.0.0 ${zeros}\n`,
          "1.0.0",
        ),
        "v1.0.0",
      );
    });

    it("rejects an incorrect release tag and malformed input", function () {
      assert.throws(
        () =>
          releaseTagForPush(
            `refs/tags/v2.0.0 ${sha} refs/tags/v2.0.0 ${zeros}`,
            "1.0.0",
          ),
        /does not match/,
      );
      assert.throws(
        () => releaseTagForPush("incomplete", "1.0.0"),
        /Invalid pre-push/,
      );
    });

    it("runs the release gate for a matching tag and propagates its failure", async function () {
      const directory = await mkdtemp(
        path.join(os.tmpdir(), "banyan-push-test-"),
      );
      try {
        const windows = process.platform === "win32";
        const command = path.join(directory, windows ? "pnpm.cmd" : "pnpm");
        await writeFile(
          command,
          windows ? "@echo off\r\nexit /b 17\r\n" : "#!/bin/sh\nexit 17\n",
        );
        await chmod(command, 0o755);
        const tag = `v${version}`;
        const hookDirectory = path.join(directory, "hooks");
        await installGitHook(
          path.join(hookDirectory, "pre-push"),
          path.join(root, ".githooks", "pre-push"),
        );
        const inputPath = path.join(directory, "refs.txt");
        await writeFile(
          inputPath,
          `refs/tags/${tag} ${sha} refs/tags/${tag} ${zeros}\n`,
        );
        const result = spawnSync(
          "git",
          [
            "-c",
            `core.hooksPath=${hookDirectory}`,
            "hook",
            "run",
            `--to-stdin=${inputPath}`,
            "pre-push",
            "--",
            "origin",
            "https://example.invalid/repo.git",
          ],
          {
            cwd: root,
            env: {
              ...process.env,
              PATH: `${directory}${path.delimiter}${process.env.PATH || ""}`,
            },
            encoding: "utf8",
          },
        );
        assert.strictEqual(result.status, 17, result.stderr);
        assert.include(
          result.stdout + result.stderr,
          `Testing release tag ${tag}`,
        );
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });
  });
});
