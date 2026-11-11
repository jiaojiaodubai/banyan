import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { verifyProductionReceipt } from "../scripts/verifyProductionReceipt.mjs";

describe("production release receipt", function () {
  let directory: string;
  let options: {
    xpi: string;
    receiptPath: string;
    updatePath: string;
    addonID: string;
    version: string;
    updateLink: string;
    tag: string;
  };

  beforeEach(async function () {
    directory = await mkdtemp(path.join(os.tmpdir(), "banyan-receipt-test-"));
    options = {
      xpi: path.join(directory, "banyan.xpi"),
      receiptPath: path.join(directory, "prod-tested.json"),
      updatePath: path.join(directory, "update.json"),
      addonID: "test@example.org",
      version: "1.0.0",
      updateLink: "https://example.org/banyan.xpi",
      tag: "v1.0.0",
    };
    const bytes = Buffer.from("tested package");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const sha512 = createHash("sha512").update(bytes).digest("hex");
    await writeFile(options.xpi, bytes);
    await writeFile(
      options.receiptPath,
      JSON.stringify({
        xpi: options.xpi,
        addonID: options.addonID,
        version: options.version,
        sha256,
      }),
    );
    await writeFile(
      options.updatePath,
      JSON.stringify({
        addons: {
          [options.addonID]: {
            updates: [
              {
                version: options.version,
                update_hash: `sha512:${sha512}`,
                update_link: options.updateLink,
              },
            ],
          },
        },
      }),
    );
  });

  afterEach(async function () {
    await rm(directory, { recursive: true, force: true });
  });

  it("accepts the tested bytes and matching update manifest", async function () {
    assert.match(await verifyProductionReceipt(options), /^[a-f0-9]{64}$/);
  });

  it("rejects a rebuilt XPI", async function () {
    await writeFile(options.xpi, "different package");
    await assert.rejects(
      verifyProductionReceipt(options),
      /differs from the production-tested bytes/,
    );
  });

  it("rejects a different release tag", async function () {
    await assert.rejects(
      verifyProductionReceipt({ ...options, tag: "v2.0.0" }),
      /does not match package version/,
    );
  });

  it("rejects a changed update manifest", async function () {
    await writeFile(
      options.updatePath,
      JSON.stringify({ addons: { [options.addonID]: { updates: [] } } }),
    );
    await assert.rejects(verifyProductionReceipt(options), /Update manifest/);
  });

  it("rejects a missing receipt", async function () {
    await rm(options.receiptPath);
    await assert.rejects(
      verifyProductionReceipt(options),
      /Missing or invalid/,
    );
  });
});
