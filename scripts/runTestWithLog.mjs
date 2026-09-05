import { spawn } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const logPath = path.join(rootDir, "dev", "test-results.log");
const stripAnsi = (value) =>
  value.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");

await mkdir(path.dirname(logPath), { recursive: true });
writeFileSync(
  logPath,
  `# Banyan test results\n# Started: ${new Date().toISOString()}\n\n`,
  "utf8",
);

function appendLog(value) {
  appendFileSync(logPath, stripAnsi(value), "utf8");
}

const command = process.platform === "win32" ? "zotero-plugin.cmd" : "zotero-plugin";
// Node cannot spawn .cmd/.bat directly on Windows without a shell.
const child = spawn(command, ["test"], {
  cwd: rootDir,
  env: process.env,
  stdio: ["inherit", "pipe", "pipe"],
  shell: process.platform === "win32",
});

function pipe(stream, target) {
  stream.on("data", (chunk) => {
    target.write(chunk);
    appendLog(chunk.toString("utf8"));
  });
}

pipe(child.stdout, process.stdout);
pipe(child.stderr, process.stderr);

const exitCode = await new Promise((resolve) => {
  child.on("error", (error) => {
    const message = `\n[runTestWithLog] failed to start zotero-plugin test: ${error.message}\n`;
    process.stderr.write(message);
    appendLog(message);
    resolve(1);
  });
  child.on("close", (code, signal) => {
    if (signal) {
      appendLog(`\n# Finished: ${new Date().toISOString()} signal=${signal}\n`);
      resolve(1);
      return;
    }
    appendLog(`\n# Finished: ${new Date().toISOString()} exitCode=${code ?? 0}\n`);
    resolve(code ?? 0);
  });
});

process.exit(exitCode);
