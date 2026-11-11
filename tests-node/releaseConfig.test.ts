import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = {
  ...process.env,
  CI: "true",
  GITHUB_ACTIONS: "true",
  GITHUB_REF_TYPE: "tag",
  GITHUB_REF_NAME: "v-not-the-package-version",
  NODE_ENV: "production",
};

describe("CI release configuration", function () {
  this.timeout(15000);

  it("verifies instead of rebuilding after the smoke test", function () {
    const script = `
      import { Config } from "zotero-plugin-scaffold";
      const config = await Config.loadConfig();
      if (config.release.bumpp.execute !== "pnpm verify:prod") process.exit(1);
      if (typeof config.release.hooks["release:push"] !== "function") process.exit(1);
    `;
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", script],
      { cwd: root, env, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
  });

  it("rejects an incorrect tag before the upload hook completes", function () {
    const script = `
      import { Config } from "zotero-plugin-scaffold";
      const config = await Config.loadConfig();
      await config.hooks.callHook("release:push", config);
    `;
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", script],
      { cwd: root, env, encoding: "utf8" },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /does not match package version/);
  });
});
