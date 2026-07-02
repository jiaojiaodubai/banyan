import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const presetsDir = path.join(rootDir, "addon", "content", "styleEditor", "presets");
const outputJSONPath = path.join(presetsDir, "presets-manifest.json");

async function main() {
  const entries = await readdir(presetsDir, { withFileTypes: true });
  const jsFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  if (!jsFiles.length) {
    throw new Error(`No .js preset files found in ${presetsDir}.`);
  }

  await writeFile(
    outputJSONPath,
    `${JSON.stringify(jsFiles, null, 2)}\n`,
    "utf8",
  );

  console.log(
    `[gen:presets-manifest] Generated ${path.relative(rootDir, outputJSONPath)} with ${jsFiles.length} files.`,
  );
}

main().catch((error) => {
  console.error("[gen:presets-manifest] Failed:", error);
  process.exitCode = 1;
});
