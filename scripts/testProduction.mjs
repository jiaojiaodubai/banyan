import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import {
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { finished } from "node:stream/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { config as loadDotenv } from "dotenv";
import { checkProductionPackage } from "./checkProductionPackage.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dotenv = loadDotenv({ path: path.join(root, ".env"), quiet: true });
if (dotenv.error && dotenv.error.code !== "ENOENT") throw dotenv.error;
const { config, version } = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
);
const { addonID, addonRef, addonInstance } = config;
const xpi = path.resolve(
  process.env.BANYAN_PROD_XPI ||
    path.join(root, ".scaffold/build", `${addonRef}.xpi`),
);
const binary = process.env.ZOTERO_PLUGIN_ZOTERO_BIN_PATH;
const timeout = Number(process.env.BANYAN_PROD_TIMEOUT_MS || 150000);
const logPath = path.join(root, ".scaffold", "prod-smoke.log");
const receiptPath = path.join(root, ".scaffold", "prod-tested.json");
await rm(receiptPath, { force: true });
if (!binary)
  throw new Error("Set ZOTERO_PLUGIN_ZOTERO_BIN_PATH to the Zotero executable");
if (!Number.isSafeInteger(timeout) || timeout <= 0)
  throw new Error("BANYAN_PROD_TIMEOUT_MS must be a positive integer");
await checkProductionPackage(xpi);
const hash = async (file) =>
  createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
const originalHash = await hash(xpi);
let activeChild;
let interruption;
let stopPromise;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    interruption = signal;
    if (activeChild)
      void requestStop(activeChild).catch((error) =>
        process.stderr.write(`${error}\n`),
      );
  });
}
const temp = await mkdtemp(path.join(os.tmpdir(), "banyan-prod-test-"));
const profile = path.join(temp, "profile");
const data = path.join(temp, "data");
const resultPath = path.join(data, "banyan-prod-result.json");
const installedXpi = path.join(profile, "extensions", `${addonID}.xpi`);
const execFileAsync = promisify(execFile);

async function terminate(child) {
  if (!child.pid) return;
  if (process.platform !== "win32") {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
    return;
  }
  const command =
    "Get-CimInstance Win32_Process -Filter \"Name = 'zotero.exe'\" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:BANYAN_SMOKE_PROFILE) } | Select-Object -ExpandProperty ProcessId | ConvertTo-Json -Compress";
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", command],
    { env: { ...process.env, BANYAN_SMOKE_PROFILE: profile } },
  );
  const found = stdout.trim() ? JSON.parse(stdout) : [];
  const pids = new Set(Array.isArray(found) ? found : [found]);
  if (child.exitCode === null && child.signalCode === null) pids.add(child.pid);
  for (const pid of pids) {
    try {
      await execFileAsync("taskkill.exe", ["/PID", String(pid), "/T", "/F"]);
    } catch (error) {
      if (error.code !== 128) throw error;
    }
  }
}

function requestStop(child) {
  stopPromise ||= terminate(child).catch((error) => {
    child.kill("SIGKILL");
    throw error;
  });
  return stopPromise;
}

try {
  await mkdir(path.join(profile, "extensions"), { recursive: true });
  await mkdir(path.join(data, "banyan"), { recursive: true });
  await mkdir(path.join(temp, "tmp"));
  await mkdir(path.dirname(logPath), { recursive: true });
  await copyFile(xpi, installedXpi);
  if ((await hash(installedXpi)) !== originalHash)
    throw new Error("Installed XPI does not match the source XPI");
  await cp(
    path.join(root, "test-prod", "observer"),
    path.join(temp, "observer"),
    { recursive: true },
  );
  const observerManifest = JSON.parse(
    await readFile(path.join(temp, "observer", "manifest.json"), "utf8"),
  );
  await writeFile(
    path.join(profile, "extensions", observerManifest.applications.zotero.id),
    path.join(temp, "observer"),
  );
  await copyFile(
    path.join(root, "test-prod/fixtures/manual-gui-disposable.js"),
    path.join(data, "banyan", "manual-gui-disposable.js"),
  );
  const prefs = {
    "banyan.testObserver.config": JSON.stringify({
      addonID,
      addonRef,
      addonInstance,
    }),
    "extensions.autoDisableScopes": 0,
    "extensions.update.enabled": false,
    "app.update.enabled": false,
    "extensions.zotero.firstRun.skipFirefoxProfileAccessCheck": true,
    "extensions.zotero.firstRunGuidance": false,
    "extensions.zotero.firstRun2": false,
    "extensions.zotero.httpServer.enabled": false,
    "extensions.zotero.sync.autoSync": false,
    "extensions.zotero.automaticScraperUpdates": false,
    "extensions.zoteroWinWordIntegration.skipInstallation": true,
    "extensions.zoteroMacWordIntegration.skipInstallation": true,
    "extensions.zoteroOpenOfficeIntegration.skipInstallation": true,
  };
  await writeFile(
    path.join(profile, "user.js"),
    Object.entries(prefs)
      .map(
        ([key, value]) =>
          `user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`,
      )
      .join("\n"),
  );
  for (let run = 1; run <= 2; run++) {
    if (interruption) throw new Error(`Interrupted by ${interruption}`);
    await rm(resultPath, { force: true });
    const log = createWriteStream(logPath, { flags: run === 1 ? "w" : "a" });
    const tempEnv = path.join(temp, "tmp");
    const child = spawn(
      path.normalize(binary),
      [
        "--purgecaches",
        "-no-remote",
        "-profile",
        profile,
        "--dataDir",
        data,
        "-ZoteroDebugText",
      ],
      {
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, TMPDIR: tempEnv, TMP: tempEnv, TEMP: tempEnv },
      },
    );
    activeChild = child;
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    const outcome = await new Promise((resolve) => {
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        void requestStop(child).catch((error) => {
          process.stderr.write(`${error}\n`);
          child.kill("SIGKILL");
        });
      }, timeout);
      child.once("error", (error) => {
        clearTimeout(timer);
        resolve(error.message);
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        resolve(timedOut ? "timeout" : code);
      });
    });
    if (stopPromise) await stopPromise;
    activeChild = undefined;
    stopPromise = undefined;
    log.end();
    await finished(log);
    if (interruption) throw new Error(`Interrupted by ${interruption}`);
    if (outcome !== 0)
      throw new Error(`Zotero run ${run} failed: ${outcome}; log: ${logPath}`);
    let result;
    try {
      result = JSON.parse(await readFile(resultPath, "utf8"));
    } catch (error) {
      throw new Error(
        `Zotero run ${run} did not produce a valid observer result; log: ${logPath}`,
        { cause: error },
      );
    }
    if (!result.ok)
      throw new Error(
        `Production run ${run} failed: ${result.error}; log: ${logPath}`,
      );
    if ((await hash(installedXpi)) !== originalHash)
      throw new Error("Installed XPI changed during production test");
    process.stdout.write(
      `Production run ${run} passed: ${result.resource}; ${result.label}\n`,
    );
  }
  if (interruption) throw new Error(`Interrupted by ${interruption}`);
  if ((await hash(xpi)) !== originalHash)
    throw new Error("XPI changed during production test");
} finally {
  try {
    if (activeChild) await requestStop(activeChild);
  } finally {
    await rm(temp, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 500,
    });
  }
}
try {
  if (interruption) throw new Error(`Interrupted by ${interruption}`);
  await writeFile(
    receiptPath,
    JSON.stringify({ xpi, addonID, version, sha256: originalHash }) + "\n",
  );
  if (interruption) throw new Error(`Interrupted by ${interruption}`);
} catch (error) {
  await rm(receiptPath, { force: true });
  throw error;
}
process.stdout.write(`XPI SHA-256: ${originalHash}\n`);
