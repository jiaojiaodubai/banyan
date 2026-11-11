import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function verifyProductionReceipt({
  xpi,
  receiptPath,
  updatePath,
  addonID,
  version,
  updateLink,
  tag,
}) {
  if (tag && tag !== `v${version}`)
    throw new Error(
      `Release tag ${tag} does not match package version ${version}`,
    );
  let receipt;
  try {
    receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  } catch (error) {
    throw new Error("Missing or invalid production test receipt", {
      cause: error,
    });
  }
  if (
    receipt.xpi !== path.resolve(xpi) ||
    receipt.addonID !== addonID ||
    receipt.version !== version
  ) {
    throw new Error(
      "Production test receipt does not match this XPI, add-on or version",
    );
  }
  const contents = await readFile(xpi);
  const sha256 = createHash("sha256").update(contents).digest("hex");
  if (receipt.sha256 !== sha256)
    throw new Error("XPI differs from the production-tested bytes");
  const sha512 = createHash("sha512").update(contents).digest("hex");
  const manifest = JSON.parse(await readFile(updatePath, "utf8"));
  const updates = manifest.addons?.[addonID]?.updates;
  const matching = Array.isArray(updates)
    ? updates.filter((item) => item.version === version)
    : [];
  if (
    matching.length !== 1 ||
    matching[0].update_hash !== `sha512:${sha512}` ||
    matching[0].update_link !== updateLink
  ) {
    throw new Error(
      "Update manifest does not point to the tested XPI and its SHA-512 hash",
    );
  }
  return sha256;
}

export async function verifyCurrentProductionReceipt() {
  const pkg = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  );
  const { addonID, addonRef } = pkg.config;
  const xpi = path.join(root, ".scaffold/build", `${addonRef}.xpi`);
  const repository = new URL(pkg.repository.url.replace(/^git\+/, ""));
  repository.pathname = `${repository.pathname.replace(/\.git\/?$/, "")}/releases/download/v${pkg.version}/${addonRef}.xpi`;
  repository.search = "";
  repository.hash = "";
  if (
    process.env.GITHUB_ACTIONS === "true" &&
    (process.env.GITHUB_REF_TYPE !== "tag" || !process.env.GITHUB_REF_NAME)
  ) {
    throw new Error("A GitHub release must run from a version tag");
  }
  return verifyProductionReceipt({
    xpi,
    receiptPath: path.join(root, ".scaffold/prod-tested.json"),
    updatePath: path.join(
      root,
      ".scaffold/build",
      pkg.version.includes("-") ? "update-beta.json" : "update.json",
    ),
    addonID,
    version: pkg.version,
    updateLink: repository.href,
    tag: process.env.GITHUB_REF_NAME || process.env.BANYAN_RELEASE_TAG,
  });
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  verifyCurrentProductionReceipt()
    .then((hash) =>
      process.stdout.write(`Production-tested XPI verified: ${hash}\n`),
    )
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}
