import wpsAddinManifest from "../../addon/content/integration/WPS/addin-manifest.json";
import { useL10n } from "../utils/locale";

const { Subprocess } = ChromeUtils.importESModule(
  "resource://gre/modules/Subprocess.sys.mjs",
) as typeof import("resource://gre/modules/Subprocess.sys.mjs");

// ── Word Add-in ──────────────────────────────────────────────
const WORD_ADDIN_MANIFEST_URL =
  "https://ftp.zotero-chinese.com/addins/banyan/word/manifest.xml";
// The manifest URL serves a single file; the add-in’s web app is
// hosted under the same base path.

const WORD_SHARED_CATALOG_MANIFEST_NAME = "banyan-manifest.xml";
// Current Microsoft 365 / Office desktop builds still store the shared-folder
// add-in catalog under the 16.0 WEF registry path.
// Microsoft Learn: https://learn.microsoft.com/en-us/office/dev/add-ins/testing/create-a-network-shared-folder-catalog-for-task-pane-and-content-add-ins
const WORD_OFFICE_VERSION_FALLBACKS = ["16.0"] as const;
// This GUID intentionally matches Banyan's Word manifest <Id>. We also reuse
// it as the TrustedCatalogs child key name and the registry Id value because
// Word only recognizes the entry when all three stay aligned.
const WORD_MANAGED_CATALOG_ID = "{215c818a-2712-432e-8d3f-098c48b7a755}";
const WORD_MANAGED_SHARE_NAME = "BanyanWordAddin";
const WORD_INSTALL_SCRIPT_NAME = "prepare-banyan-word-addin.ps1";

const t = useL10n(["preferences.ftl"]);

type WPSAddinAsset = {
  relativePath: string;
  content: string;
};

type WPSAddinManifest = {
  name: string;
  version: string;
  type: string;
  resourceRoot: string;
  files: string[];
};

type WindowsTrustedCatalog = {
  version: string;
  id: string;
  registryId: string | null;
  url: string;
  showInMenu: boolean;
  registryRoot: string;
  registryPath: string;
  source: "user" | "policy";
};

type WindowsTrustedCatalogRegistrySource = {
  version: string;
  rootKey: number;
  registryRoot: string;
  registryPath: string;
  source: "user" | "policy";
};

type WindowsTrustedCatalogReadResult = {
  catalogs: WindowsTrustedCatalog[];
  emptyRegistryPathCount: number;
};

type DirectoryWriteProbeResult = {
  exists: boolean;
  writable: boolean;
  probePath?: string;
  message?: string;
};

type WordTrustedCatalogScanResult = {
  catalogDir: string | null;
  selectedCatalog?: WindowsTrustedCatalog;
  versions: string[];
  totalCatalogs: number;
  emptyRegistryPathCount: number;
  invalidFormatCount: number;
  notUncCount: number;
  notInMenuCount: number;
  missingDirectoryCount: number;
  notWritableCount: number;
};

type SubprocessResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

type SubprocessReadable =
  import("resource://gre/modules/Subprocess.sys.mjs").SubprocessReadable;
type SubprocessProcess =
  import("resource://gre/modules/Subprocess.sys.mjs").SubprocessProcess;

export type WPSAddinInstallResult =
  | {
      success: true;
      targetDir: string;
    }
  | {
      success: false;
      message: string;
    };

export type WPSAddinUninstallResult =
  | {
      success: true;
      removedDirs: string[];
    }
  | {
      success: false;
      message: string;
    };

export type WordAddinInstallResult =
  | {
      success: true;
      manifestId: string;
      manifestPath: string;
    }
  | {
      success: false;
      message: string;
    };

export type WordAddinUninstallResult =
  | {
      success: true;
      removedPath: string | null;
    }
  | {
      success: false;
      message: string;
    };

let cachedWPSAddinAssets: readonly WPSAddinAsset[] | null = null;
let cachedWPSAddinManifest: WPSAddinManifest | null = null;

function logWpsAddin(stage: string, details?: Record<string, unknown>): void {
  void stage;
  void details;
}

function logWpsAddinError(
  stage: string,
  error: unknown,
  details?: Record<string, unknown>,
): void {
  void stage;
  void details;
  ztoolkit.logError(error);
}

// ── Word Add-in helpers ──────────────────────────────────────

function logWordAddin(stage: string, details?: Record<string, unknown>): void {
  void stage;
  void details;
}

function logWordAddinError(
  stage: string,
  error: unknown,
  details?: Record<string, unknown>,
): void {
  void stage;
  void details;
  ztoolkit.logError(error);
}

/**
 * Extract the add-in id from an Office manifest.xml string.
 * Looks for `<Id>...</Id>` inside the default (no-prefix) namespace.
 */
function parseWordManifestId(xmlString: string): string | null {
  // Use a simple regex because the XML may use a default namespace
  // and we only need one lightweight extraction.
  const match = xmlString.match(/<Id(?:\s[^>]*)?>([\s\S]*?)<\/Id\s*>/i);
  if (!match || !match[1]) return null;

  const id = match[1].trim();
  // Validate GUID-like pattern
  if (
    /^\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?$/i.test(
      id,
    )
  ) {
    // Normalize: remove braces, lowercase
    return id.replace(/^\{|\}$/g, "").toLowerCase();
  }

  // Return any non-empty id string
  return id || null;
}

async function findOfficeVersions(): Promise<string[]> {
  const localAppData = Services.env.get("LOCALAPPDATA");
  if (!localAppData) return [...WORD_OFFICE_VERSION_FALLBACKS];

  const officeRoot = PathUtils.join(localAppData, "Microsoft", "Office");
  if (!(await IOUtils.exists(officeRoot))) {
    return [...WORD_OFFICE_VERSION_FALLBACKS];
  }

  const detected = (await IOUtils.getChildren(officeRoot))
    .map((p) => PathUtils.filename(p))
    .filter((name) => /^\d+\.\d+$/.test(name))
    .sort((a, b) => {
      const [aMajor, aMinor] = a.split(".").map(Number);
      const [bMajor, bMinor] = b.split(".").map(Number);
      if (aMajor !== bMajor) return bMajor - aMajor;
      return bMinor - aMinor;
    });

  for (const version of WORD_OFFICE_VERSION_FALLBACKS) {
    if (!detected.includes(version)) {
      detected.push(version);
    }
  }

  return detected;
}

function createWindowsRegKey(): nsIWindowsRegKey {
  return Cc["@mozilla.org/windows-registry-key;1"].createInstance(
    Ci.nsIWindowsRegKey,
  );
}

async function readSubprocessString(
  stream: SubprocessReadable | null | undefined,
): Promise<string> {
  if (!stream?.readString) {
    return "";
  }

  let output = "";
  let chunk: string | null;
  while ((chunk = await stream.readString())) {
    output += chunk;
  }
  return output;
}

function getSubprocessExitCode(
  proc: Pick<SubprocessProcess, "exitCode" | "exitValue"> | null | undefined,
): number | null {
  if (typeof proc?.exitCode === "number") {
    return proc.exitCode;
  }
  if (typeof proc?.exitValue === "number") {
    return proc.exitValue;
  }
  return null;
}

async function runSubprocess(options: {
  command: string;
  args: string[];
  workdir?: string;
}): Promise<SubprocessResult> {
  const proc = await Subprocess.call({
    command: options.command,
    arguments: options.args,
    workdir: options.workdir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, waitResult] = await Promise.all([
    readSubprocessString(proc.stdout),
    readSubprocessString(proc.stderr),
    proc.wait(),
  ]);
  const exitCode =
    typeof waitResult?.exitCode === "number"
      ? waitResult.exitCode
      : getSubprocessExitCode(proc);

  return {
    exitCode,
    stdout,
    stderr,
  };
}

function getLocalAppDataDir(): string {
  const localAppData = Services.env.get("LOCALAPPDATA");
  if (localAppData) return localAppData;

  return PathUtils.join(getHomeDir(), "AppData", "Local");
}

function getWordManagedCatalogDir(): string {
  return PathUtils.join(getLocalAppDataDir(), "Banyan", "WordAddinCatalog");
}

function getWordManagedCatalogUnc(): string {
  const computerName = Services.env.get("COMPUTERNAME").trim();
  const host = computerName || "localhost";
  return `\\\\${host}\\${WORD_MANAGED_SHARE_NAME}`;
}

function getWindowsPowerShellPath(): string {
  const systemRoot = Services.env.get("SystemRoot") || "C:\\Windows";
  return PathUtils.join(
    systemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
}

function quotePowerShellString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function writeUTF8WithBom(path: string, content: string): Promise<void> {
  const utf8 = new TextEncoder().encode(content);
  const data = new Uint8Array(utf8.length + 3);
  data.set([0xef, 0xbb, 0xbf], 0);
  data.set(utf8, 3);
  await IOUtils.write(path, data);
}

function getWordTrustedCatalogRegistryPath(version: string): string {
  return `Software\\Microsoft\\Office\\${version}\\WEF\\TrustedCatalogs`;
}

function isGuidLike(value: string): boolean {
  return /^\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?$/i.test(
    value.trim(),
  );
}

function normalizeGuidLike(value: string): string {
  return value
    .trim()
    .replace(/^\{|\}$/g, "")
    .toLowerCase();
}

// Word does not honor arbitrary child keys under TrustedCatalogs. In testing it
// only surfaced the Microsoft-documented shape: a GUID child key with a matching
// string Id value plus the Url/Flags values.
function isValidWindowsTrustedCatalogRegistryFormat(
  catalog: WindowsTrustedCatalog,
): boolean {
  if (!catalog.registryId) {
    return false;
  }

  return (
    isGuidLike(catalog.id) &&
    isGuidLike(catalog.registryId) &&
    normalizeGuidLike(catalog.id) === normalizeGuidLike(catalog.registryId)
  );
}

function writeWindowsTrustedCatalogEntry(options: {
  catalogId: string;
  url: string;
  version: string;
}): void {
  const rootKey = Ci.nsIWindowsRegKey.ROOT_KEY_CURRENT_USER;
  const accessAll = Ci.nsIWindowsRegKey.ACCESS_ALL;
  if (rootKey === undefined || accessAll === undefined) {
    throw new Error("Windows registry access is not available.");
  }

  const key = createWindowsRegKey();
  try {
    // Keep this aligned with Microsoft's shared-folder catalog example. If the
    // GUID child key and Id drift apart, Word ignores the entry even though it
    // still looks readable from our side.
    // Microsoft Learn: https://learn.microsoft.com/en-us/office/dev/add-ins/testing/create-a-network-shared-folder-catalog-for-task-pane-and-content-add-ins
    key.create(
      rootKey,
      `${getWordTrustedCatalogRegistryPath(options.version)}\\${options.catalogId}`,
      accessAll,
    );
    key.writeStringValue("Id", options.catalogId);
    key.writeStringValue("Url", options.url);
    key.writeIntValue("Flags", 1);
  } finally {
    key.close();
  }
}

function removeWindowsTrustedCatalogEntry(options: {
  catalogId: string;
  logEvent?: string;
  logMissingParent?: boolean;
  version: string;
}): boolean {
  const rootKey = Ci.nsIWindowsRegKey.ROOT_KEY_CURRENT_USER;
  const accessAll = Ci.nsIWindowsRegKey.ACCESS_ALL;
  if (rootKey === undefined || accessAll === undefined) return false;

  const parentKey = createWindowsRegKey();
  let didOpenParent = false;
  try {
    parentKey.open(
      rootKey,
      getWordTrustedCatalogRegistryPath(options.version),
      accessAll,
    );
    didOpenParent = true;
    if (parentKey.hasChild(options.catalogId)) {
      parentKey.removeChild(options.catalogId);
      return true;
    }
    return false;
  } catch (error) {
    if (didOpenParent || options.logMissingParent === true) {
      logWordAddin(
        options.logEvent ?? "trusted-catalog.managed.unregister.skip",
        {
          catalogId: options.catalogId,
          message: formatInstallError(error),
          version: options.version,
        },
      );
    }
    return false;
  } finally {
    try {
      parentKey.close();
    } catch {
      // Ignore close errors for unopened registry keys.
    }
  }
}

function getWindowsAccountName(): string {
  const userDomain = Services.env.get("USERDOMAIN");
  const username = Services.env.get("USERNAME");
  if (userDomain && username) {
    return `${userDomain}\\${username}`;
  }
  if (username) return username;

  throw new Error("Cannot determine the current Windows account name.");
}

type WordInstallScriptMessages = {
  windowTitle: string;
  intro: string;
  permissionHint: string;
  keepWindowOpenHint: string;
  createDirectory: string;
  applyPermissions: string;
  reuseShare: string;
  createShare: string;
  fallbackShare: string;
  complete: string;
  completeCloseHint: string;
  failed: string;
  failedCloseHint: string;
};

function getWordInstallScriptMessages(): WordInstallScriptMessages {
  return {
    windowTitle: t("prefs-word-addon-script-title"),
    intro: t("prefs-word-addon-script-intro"),
    permissionHint: t("prefs-word-addon-script-permission-hint"),
    keepWindowOpenHint: t("prefs-word-addon-script-keep-open-hint"),
    createDirectory: t("prefs-word-addon-script-create-directory"),
    applyPermissions: t("prefs-word-addon-script-apply-permissions"),
    reuseShare: t("prefs-word-addon-script-reuse-share"),
    createShare: t("prefs-word-addon-script-create-share"),
    fallbackShare: t("prefs-word-addon-script-fallback-share"),
    complete: t("prefs-word-addon-script-complete"),
    completeCloseHint: t("prefs-word-addon-script-complete-close-hint"),
    failed: t("prefs-word-addon-script-failed"),
    failedCloseHint: t("prefs-word-addon-script-failed-close-hint"),
  };
}

function getPrepareWindowsWordCatalogScriptContent(): string {
  const messages = getWordInstallScriptMessages();
  return String.raw`param(
  [Parameter(Mandatory = $true)][string]$CatalogDir,
  [Parameter(Mandatory = $true)][string]$ShareName,
  [Parameter(Mandatory = $true)][string]$AccountName,
  [Parameter(Mandatory = $true)][string]$LogPath
)

$ErrorActionPreference = "Stop"

$windowTitle = ${quotePowerShellString(messages.windowTitle)}
$intro = ${quotePowerShellString(messages.intro)}
$permissionHint = ${quotePowerShellString(messages.permissionHint)}
$keepWindowOpenHint = ${quotePowerShellString(messages.keepWindowOpenHint)}
$createDirectory = ${quotePowerShellString(messages.createDirectory)}
$applyPermissions = ${quotePowerShellString(messages.applyPermissions)}
$reuseShare = ${quotePowerShellString(messages.reuseShare)}
$createShare = ${quotePowerShellString(messages.createShare)}
$fallbackShare = ${quotePowerShellString(messages.fallbackShare)}
$complete = ${quotePowerShellString(messages.complete)}
$completeCloseHint = ${quotePowerShellString(messages.completeCloseHint)}
$failed = ${quotePowerShellString(messages.failed)}
$failedCloseHint = ${quotePowerShellString(messages.failedCloseHint)}

function Write-BanyanLog {
  param([string]$Message)
  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Add-Content -LiteralPath $LogPath -Value "[$timestamp] $Message" -Encoding UTF8
}

function Write-BanyanStatus {
  param(
    [string]$Message,
    [string]$Color = "Gray"
  )
  Write-Host $Message -ForegroundColor $Color
  Write-BanyanLog $Message
}

try {
  try {
    $host.UI.RawUI.WindowTitle = $windowTitle
  } catch {
    # Ignore window-title failures in restricted hosts.
  }

  New-Item -ItemType Directory -Path (Split-Path -Parent $LogPath) -Force | Out-Null
  Write-BanyanStatus $intro "Cyan"
  Write-BanyanStatus $permissionHint "Yellow"
  Write-BanyanStatus $keepWindowOpenHint "Yellow"
  Write-Host ""
  Write-BanyanLog "CatalogDir=$CatalogDir"
  Write-BanyanLog "ShareName=$ShareName"

  Write-BanyanStatus $createDirectory
  New-Item -ItemType Directory -Path $CatalogDir -Force | Out-Null

  Write-BanyanStatus $applyPermissions
  $acl = Get-Acl -LiteralPath $CatalogDir
  $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
    $AccountName,
    "Modify",
    "ContainerInherit,ObjectInherit",
    "None",
    "Allow"
  )
  $acl.SetAccessRule($rule)
  Set-Acl -LiteralPath $CatalogDir -AclObject $acl

  if (Get-Command Get-SmbShare -ErrorAction SilentlyContinue) {
    $share = Get-SmbShare -Name $ShareName -ErrorAction SilentlyContinue
    if ($share) {
      $sharePath = [System.IO.Path]::GetFullPath($share.Path)
      $targetPath = [System.IO.Path]::GetFullPath($CatalogDir)
      if ($sharePath -ne $targetPath) {
        throw "Existing SMB share '$ShareName' points to $sharePath instead of $targetPath."
      }

      Write-BanyanStatus $reuseShare
      Grant-SmbShareAccess -Name $ShareName -AccountName $AccountName -AccessRight Full -Force | Out-Null
    } else {
      Write-BanyanStatus $createShare
      New-SmbShare -Name $ShareName -Path $CatalogDir -FullAccess $AccountName | Out-Null
    }
  } else {
    Write-BanyanStatus $fallbackShare
    & net.exe share $ShareName | Out-Null
    if ($LASTEXITCODE -eq 0) {
      & net.exe share $ShareName "/GRANT:$AccountName,FULL" | Out-Null
    } else {
      & net.exe share "$ShareName=$CatalogDir" "/GRANT:$AccountName,FULL" | Out-Null
    }
    if ($LASTEXITCODE -ne 0) {
      throw "net share failed with exit code $LASTEXITCODE"
    }
  }

  Write-Host ""
  Write-BanyanStatus $complete "Green"
  Write-BanyanStatus $completeCloseHint "DarkGray"
  Start-Sleep -Seconds 5
  exit 0
} catch {
  Write-Host ""
  Write-BanyanStatus $failed "Red"
  Write-BanyanLog "Failed: $($_.Exception.Message)"
  Write-Error $_
  [void](Read-Host $failedCloseHint)
  exit 1
}
`;
}

async function prepareWindowsWordSharedCatalog(): Promise<string> {
  const versions = await findOfficeVersions();
  if (!versions.length) {
    throw new Error(
      "Cannot determine the Office version for Word sideloading.",
    );
  }

  const catalogDir = getWordManagedCatalogDir();
  const catalogUnc = getWordManagedCatalogUnc();
  await IOUtils.makeDirectory(catalogDir, {
    createAncestors: true,
    ignoreExisting: true,
  });

  const scriptPath = PathUtils.join(catalogDir, WORD_INSTALL_SCRIPT_NAME);
  const logPath = PathUtils.join(catalogDir, "prepare-banyan-word-addin.log");
  // Windows PowerShell 5.1 reads UTF-8 .ps1 files without BOM as the system
  // ANSI code page. The localized status text would be mojibake and can break
  // parsing before the helper has a chance to write its own log.
  // Microsoft Learn: https://learn.microsoft.com/en-us/office/dev/add-ins/testing/create-a-network-shared-folder-catalog-for-task-pane-and-content-add-ins
  await writeUTF8WithBom(
    scriptPath,
    getPrepareWindowsWordCatalogScriptContent(),
  );
  await IOUtils.writeUTF8(logPath, "");

  const accountName = getWindowsAccountName();
  const elevatedArgs = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath,
    "-CatalogDir",
    catalogDir,
    "-ShareName",
    WORD_MANAGED_SHARE_NAME,
    "-AccountName",
    accountName,
    "-LogPath",
    logPath,
  ];
  const elevatedArgsText = elevatedArgs.map(quotePowerShellString).join(", ");
  const powershellPath = getWindowsPowerShellPath();
  const command = [
    "$process = Start-Process",
    `-FilePath ${quotePowerShellString(powershellPath)}`,
    `-ArgumentList @(${elevatedArgsText})`,
    "-Verb RunAs",
    "-WindowStyle Normal",
    "-Wait",
    "-PassThru;",
    "exit $process.ExitCode",
  ];

  logWordAddin("trusted-catalog.managed.prepare.start", {
    catalogDir,
    catalogUnc,
    logPath,
    shareName: WORD_MANAGED_SHARE_NAME,
    versions,
  });

  const result = await runSubprocess({
    command: powershellPath,
    args: [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      command.join(" "),
    ],
    workdir: catalogDir,
  });

  let helperLog = "";
  try {
    if (await IOUtils.exists(logPath)) {
      helperLog = await IOUtils.readUTF8(logPath);
    }
  } catch (error) {
    helperLog = `Cannot read helper log: ${formatInstallError(error)}`;
  }

  logWordAddin("trusted-catalog.managed.prepare.finish", {
    exitCode: result.exitCode,
    helperLog,
    stderr: result.stderr,
    stdout: result.stdout,
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to prepare the local Word shared catalog. ${result.stderr.trim() || helperLog.trim() || "Windows permission prompt may have been cancelled."}`,
    );
  }

  for (const version of versions) {
    writeWindowsTrustedCatalogEntry({
      catalogId: WORD_MANAGED_CATALOG_ID,
      url: catalogUnc,
      version,
    });
  }

  logWordAddin("trusted-catalog.managed.register", {
    catalogId: WORD_MANAGED_CATALOG_ID,
    url: catalogUnc,
    versions,
  });

  const probe = await probeDirectoryWriteAccess(catalogUnc);
  if (!probe.exists || !probe.writable) {
    throw new Error(
      `The local Word shared catalog was prepared, but Banyan cannot access ${catalogUnc}. ${probe.message ?? ""}`.trim(),
    );
  }

  return catalogUnc;
}

function getWordTrustedCatalogRegistrySources(
  version: string,
): WindowsTrustedCatalogRegistrySource[] {
  const currentUser = Ci.nsIWindowsRegKey.ROOT_KEY_CURRENT_USER;
  const localMachine = Ci.nsIWindowsRegKey.ROOT_KEY_LOCAL_MACHINE;
  const sources: WindowsTrustedCatalogRegistrySource[] = [];

  if (currentUser !== undefined) {
    sources.push({
      version,
      rootKey: currentUser,
      registryRoot: "HKCU",
      registryPath: getWordTrustedCatalogRegistryPath(version),
      source: "user",
    });
    sources.push({
      version,
      rootKey: currentUser,
      registryRoot: "HKCU",
      registryPath: `Software\\Policies\\Microsoft\\Office\\${version}\\WEF\\TrustedCatalogs`,
      source: "policy",
    });
  }

  if (localMachine !== undefined) {
    sources.push({
      version,
      rootKey: localMachine,
      registryRoot: "HKLM",
      registryPath: `Software\\Policies\\Microsoft\\Office\\${version}\\WEF\\TrustedCatalogs`,
      source: "policy",
    });
  }

  return sources;
}

function readWindowsTrustedCatalogs(
  version: string,
): WindowsTrustedCatalogReadResult {
  const accessRead = Ci.nsIWindowsRegKey.ACCESS_READ;
  if (accessRead === undefined) {
    return {
      catalogs: [],
      emptyRegistryPathCount: 0,
    };
  }

  const catalogs: WindowsTrustedCatalog[] = [];
  let emptyRegistryPathCount = 0;
  for (const source of getWordTrustedCatalogRegistrySources(version)) {
    const key = createWindowsRegKey();
    try {
      key.open(source.rootKey, source.registryPath, accessRead);
      if (key.childCount === 0) {
        emptyRegistryPathCount += 1;
      }

      for (let i = 0; i < key.childCount; i++) {
        const id = key.getChildName(i);
        const child = key.openChild(id, accessRead);
        try {
          if (child.hasValue("Url")) {
            const registryId = child.hasValue("Id")
              ? child.readStringValue("Id").trim()
              : null;
            const url = child.readStringValue("Url").trim();
            const flags = child.hasValue("Flags")
              ? child.readIntValue("Flags")
              : 0;
            if (url) {
              catalogs.push({
                version,
                id,
                registryId,
                url,
                showInMenu: (flags & 1) === 1,
                registryRoot: source.registryRoot,
                registryPath: source.registryPath,
                source: source.source,
              });
            }
          }
        } finally {
          child.close();
        }
      }
    } catch (error) {
      if (source.source === "user") {
        logWordAddin("trusted-catalog.registry.read-failed", {
          message: formatInstallError(error),
          registryPath: source.registryPath,
          registryRoot: source.registryRoot,
          version,
        });
      }
    } finally {
      try {
        key.close();
      } catch {
        // Ignore close errors for unopened registry keys.
      }
    }
  }

  return {
    catalogs,
    emptyRegistryPathCount,
  };
}

function normalizeWindowsPath(path: string): string {
  return path.replace(/\\+$/, "");
}

async function probeDirectoryWriteAccess(
  path: string,
): Promise<DirectoryWriteProbeResult> {
  if (!(await IOUtils.exists(path))) {
    return {
      exists: false,
      writable: false,
      message: "Directory does not exist.",
    };
  }

  const probePath = PathUtils.join(
    path,
    `.banyan-write-test-${Date.now()}.tmp`,
  );
  try {
    await IOUtils.writeUTF8(probePath, "");
    await IOUtils.remove(probePath, { ignoreAbsent: true });
    return {
      exists: true,
      writable: true,
      probePath,
    };
  } catch (error) {
    return {
      exists: true,
      writable: false,
      probePath,
      message: formatInstallError(error),
    };
  }
}

async function findWritableWordTrustedCatalogDir(options?: {
  requireShowInMenu?: boolean;
}): Promise<WordTrustedCatalogScanResult> {
  const requireShowInMenu = options?.requireShowInMenu === true;
  const versions = await findOfficeVersions();
  const summary: WordTrustedCatalogScanResult = {
    catalogDir: null,
    versions,
    totalCatalogs: 0,
    emptyRegistryPathCount: 0,
    invalidFormatCount: 0,
    notUncCount: 0,
    notInMenuCount: 0,
    missingDirectoryCount: 0,
    notWritableCount: 0,
  };

  for (const version of versions) {
    const readResult = readWindowsTrustedCatalogs(version);
    const catalogs = readResult.catalogs;
    summary.totalCatalogs += catalogs.length;
    summary.emptyRegistryPathCount += readResult.emptyRegistryPathCount;

    for (const catalog of catalogs) {
      const { id, registryId, showInMenu, url } = catalog;

      if (!isValidWindowsTrustedCatalogRegistryFormat(catalog)) {
        summary.invalidFormatCount += 1;
        continue;
      }

      if (!url.startsWith("\\\\")) {
        summary.notUncCount += 1;
        continue;
      }

      if (requireShowInMenu && !showInMenu) {
        summary.notInMenuCount += 1;
        continue;
      }

      const catalogDir = normalizeWindowsPath(url);
      const probe = await probeDirectoryWriteAccess(catalogDir);
      if (!probe.exists) {
        summary.missingDirectoryCount += 1;
        continue;
      }

      if (!probe.writable) {
        summary.notWritableCount += 1;
        continue;
      }

      logWordAddin("trusted-catalog.select", {
        catalogDir,
        id,
        registryId,
        url,
        version,
      });
      summary.catalogDir = catalogDir;
      summary.selectedCatalog = catalog;
      return summary;
    }
  }

  logWordAddin("trusted-catalog.scan.no-writable-directory", {
    emptyRegistryPathCount: summary.emptyRegistryPathCount,
    invalidFormatCount: summary.invalidFormatCount,
    missingDirectoryCount: summary.missingDirectoryCount,
    notInMenuCount: summary.notInMenuCount,
    notUncCount: summary.notUncCount,
    notWritableCount: summary.notWritableCount,
    requireShowInMenu,
    totalCatalogs: summary.totalCatalogs,
    versions: summary.versions,
  });
  return summary;
}

async function getRemovableWordWindowsSharedCatalogManifestPathOrNull(): Promise<
  string | null
> {
  const managedManifestPath = PathUtils.join(
    getWordManagedCatalogUnc(),
    WORD_SHARED_CATALOG_MANIFEST_NAME,
  );
  if (await IOUtils.exists(managedManifestPath)) {
    return managedManifestPath;
  }

  const result = await findWritableWordTrustedCatalogDir();
  if (!result.catalogDir) return null;

  return PathUtils.join(result.catalogDir, WORD_SHARED_CATALOG_MANIFEST_NAME);
}

function getWordTrustedCatalogErrorMessage(
  result: WordTrustedCatalogScanResult,
): string {
  if (result.totalCatalogs === 0) {
    if (result.emptyRegistryPathCount > 0) {
      return "Word Trusted Add-in Catalogs is present but contains no shared folder entries for this account.";
    }

    return "No Word trusted shared folder catalog is configured for this account.";
  }

  if (result.notInMenuCount > 0 && result.notUncCount === 0) {
    return "Word trusted shared folder catalogs were found, but none are marked Show in Menu.";
  }

  if (result.missingDirectoryCount > 0 && result.notWritableCount === 0) {
    return "Word trusted shared folder catalogs were found, but the configured network share path does not exist from this machine.";
  }

  if (result.notWritableCount > 0) {
    return "Word trusted shared folder catalogs were found, but Banyan cannot write to the configured network share.";
  }

  if (result.notUncCount > 0) {
    return "Word trusted shared folder catalogs were found, but none use a UNC network share path.";
  }

  return "No writable Word trusted shared folder catalog is available.";
}

/**
 * Determine the Word WEF directory documented for macOS sideloading.
 * Returns null if the platform is unsupported.
 */
function getMacWordWefDir(): string | null {
  switch (Services.appinfo.OS) {
    case "Darwin":
      return PathUtils.join(
        getHomeDir(),
        "Library",
        "Containers",
        "com.microsoft.Word",
        "Data",
        "Documents",
        "wef",
      );
    default:
      // Linux does not have native Office support
      return null;
  }
}

async function getWordAddinManifestContent(): Promise<{
  addinId: string;
  manifestContent: string;
}> {
  const manifestContent = await Zotero.File.getContentsFromURLAsync(
    WORD_ADDIN_MANIFEST_URL,
  );

  if (!manifestContent || !manifestContent.trim()) {
    throw new Error(`Empty manifest content from ${WORD_ADDIN_MANIFEST_URL}`);
  }

  const addinId = parseWordManifestId(manifestContent);
  if (!addinId) {
    throw new Error(
      "Cannot extract <Id> from manifest.xml. The remote manifest may be malformed.",
    );
  }

  logWordAddin("manifest.parse.complete", {
    addinId,
    manifestSize: manifestContent.length,
  });

  return { addinId, manifestContent };
}

function assertManagedWordCatalogIdMatchesManifest(addinId: string): void {
  if (
    normalizeGuidLike(addinId) === normalizeGuidLike(WORD_MANAGED_CATALOG_ID)
  ) {
    return;
  }

  throw new Error(
    "The Word manifest <Id> does not match WORD_MANAGED_CATALOG_ID. Keep the managed catalog GUID aligned with manifest.xml.",
  );
}

async function installWordAddinOnWindows(
  addinId: string,
  manifestContent: string,
): Promise<string> {
  const initialScan = await findWritableWordTrustedCatalogDir({
    requireShowInMenu: true,
  });
  let catalogDir = initialScan.catalogDir;
  let preparedCatalog = false;

  if (!catalogDir) {
    logWordAddin("trusted-catalog.managed.prepare.required", {
      reason: getWordTrustedCatalogErrorMessage(initialScan),
    });
    catalogDir = await prepareWindowsWordSharedCatalog();
    preparedCatalog = true;
  }

  const manifestPath = PathUtils.join(
    catalogDir,
    WORD_SHARED_CATALOG_MANIFEST_NAME,
  );
  await IOUtils.writeUTF8(manifestPath, manifestContent);

  logWordAddin("install.complete", {
    addinId,
    manifestPath,
    preparedCatalog,
    target: "windows-shared-catalog",
  });

  return manifestPath;
}

async function installWordAddinOnMac(
  addinId: string,
  manifestContent: string,
): Promise<string> {
  const wefDir = getMacWordWefDir();
  if (!wefDir) {
    throw new Error("Microsoft Word sideloading is not supported on this OS.");
  }

  await IOUtils.makeDirectory(wefDir, {
    createAncestors: true,
    ignoreExisting: true,
  });

  const manifestPath = PathUtils.join(
    wefDir,
    WORD_SHARED_CATALOG_MANIFEST_NAME,
  );
  await IOUtils.writeUTF8(manifestPath, manifestContent);

  logWordAddin("install.complete", {
    addinId,
    manifestPath,
    target: "mac-wef",
  });

  return manifestPath;
}

async function removeWordAddinFromWindows(): Promise<string | null> {
  const manifestPath =
    await getRemovableWordWindowsSharedCatalogManifestPathOrNull();
  if (!manifestPath) {
    logWordAddin("uninstall.skip.no-trusted-catalog");
    return null;
  }

  if (!(await IOUtils.exists(manifestPath))) {
    return null;
  }

  await IOUtils.remove(manifestPath, {
    ignoreAbsent: true,
  });

  const versions = await findOfficeVersions();
  for (const version of versions) {
    removeWindowsTrustedCatalogEntry({
      catalogId: WORD_MANAGED_CATALOG_ID,
      version,
    });
  }

  return manifestPath;
}

async function removeWordAddinFromMac(): Promise<string | null> {
  const wefDir = getMacWordWefDir();
  if (!wefDir) {
    return null;
  }

  const manifestPath = PathUtils.join(
    wefDir,
    WORD_SHARED_CATALOG_MANIFEST_NAME,
  );
  if (!(await IOUtils.exists(manifestPath))) {
    return null;
  }

  await IOUtils.remove(manifestPath, {
    ignoreAbsent: true,
  });
  return manifestPath;
}

// ── WPS Add-in helpers ───────────────────────────────────────

function parseWPSAddinManifest(raw: unknown): WPSAddinManifest {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid WPS add-in manifest: expected object.");
  }

  const data = raw as Record<string, unknown>;
  const name = String(data.name ?? "").trim();
  const version = String(data.version ?? "").trim();
  const type = String(data.type ?? "wps").trim();
  const resourceRoot = String(data.resourceRoot ?? "").trim();
  const filesRaw = data.files;

  if (!Array.isArray(filesRaw)) {
    throw new Error("Invalid WPS add-in manifest: files must be an array.");
  }

  if (
    filesRaw.some(
      (entry) =>
        typeof entry !== "string" ||
        !entry ||
        entry.startsWith("/") ||
        entry.includes(".."),
    )
  ) {
    throw new Error(
      "Invalid WPS add-in manifest: files contains invalid path.",
    );
  }

  const files = filesRaw as string[];
  if (!name || !version || !resourceRoot || !files.length) {
    throw new Error(
      "Invalid WPS add-in manifest: missing required fields or files is empty.",
    );
  }

  return {
    name,
    version,
    type: type || "wps",
    resourceRoot,
    files,
  };
}

function getWPSAddinManifest(): WPSAddinManifest {
  if (cachedWPSAddinManifest) {
    return cachedWPSAddinManifest;
  }

  const manifest = parseWPSAddinManifest(wpsAddinManifest as unknown);
  cachedWPSAddinManifest = manifest;
  return manifest;
}

function getWPSAddinDirectoryName(addin: WPSAddinManifest): string {
  return `${addin.name}_${addin.version}`;
}

function getWPSAddinDirectoryPrefix(addin: WPSAddinManifest): string {
  return `${addin.name}_`;
}

function getWPSAddinAssetURL(
  addin: WPSAddinManifest,
  relativePath: string,
): string {
  return `chrome://${addon.data.config.addonRef}/content/${addin.resourceRoot}/${relativePath}`;
}

async function getWPSAddinAssets(
  addin: WPSAddinManifest,
): Promise<readonly WPSAddinAsset[]> {
  if (cachedWPSAddinAssets) {
    return cachedWPSAddinAssets;
  }

  const contents = await Promise.all(
    addin.files.map((relativePath) =>
      Zotero.File.getContentsFromURLAsync(
        getWPSAddinAssetURL(addin, relativePath),
      ),
    ),
  );

  const emptyIndex = contents.findIndex((content) => !content);
  if (emptyIndex >= 0) {
    logWpsAddinError("asset.read.empty", new Error("Empty bundled asset"), {
      relativePath: addin.files[emptyIndex],
      assetIndex: emptyIndex,
      totalFiles: addin.files.length,
    });
    throw new Error(
      `Failed to load bundled WPS asset: ${addin.files[emptyIndex]} (empty content).`,
    );
  }

  cachedWPSAddinAssets = addin.files.map((relativePath, index) => ({
    relativePath,
    content: contents[index],
  }));
  return cachedWPSAddinAssets;
}

function getHomeDir(): string {
  const home = Services.env.get("HOME") || Services.env.get("USERPROFILE");
  if (home) {
    return home;
  }

  try {
    return Services.dirsvc.get("Home", Ci.nsIFile).path;
  } catch {
    throw new Error("Cannot resolve user home directory.");
  }
}

function getWindowsAppDataDir(): string {
  const appData = Services.env.get("APPDATA");
  if (appData) {
    return appData;
  }

  try {
    return Services.dirsvc.get("AppData", Ci.nsIFile).path;
  } catch {
    throw new Error("Cannot resolve APPDATA directory.");
  }
}

function getWPSJsaddonsDir(): string {
  let resolved: string;
  switch (Services.appinfo.OS) {
    case "WINNT":
      resolved = PathUtils.join(
        getWindowsAppDataDir(),
        "kingsoft",
        "wps",
        "jsaddons",
      );
      break;
    case "Darwin":
      resolved = PathUtils.join(
        getHomeDir(),
        "Library",
        "Containers",
        "com.kingsoft.wpsoffice.mac",
        "Data",
        ".kingsoft",
        "wps",
        "jsaddons",
      );
      break;
    default:
      resolved = PathUtils.join(
        getHomeDir(),
        ".local",
        "share",
        "Kingsoft",
        "wps",
        "jsaddons",
      );
      break;
  }

  return resolved;
}

async function getInstalledWPSAddinPaths(
  jsaddonsDir: string,
  addin: WPSAddinManifest,
): Promise<string[]> {
  if (!(await IOUtils.exists(jsaddonsDir))) {
    return [];
  }

  const prefix = getWPSAddinDirectoryPrefix(addin);
  return (await IOUtils.getChildren(jsaddonsDir)).filter((path) =>
    PathUtils.filename(path).startsWith(prefix),
  );
}

async function removeInstalledWPSAddinPaths(
  paths: readonly string[],
): Promise<void> {
  await Promise.all(
    paths.map((path) =>
      IOUtils.remove(path, {
        recursive: true,
        ignoreAbsent: true,
      }),
    ),
  );
}

async function ensurePublishXML(publishXmlPath: string): Promise<void> {
  if (await IOUtils.exists(publishXmlPath)) {
    return;
  }

  await IOUtils.writeUTF8(
    publishXmlPath,
    '<?xml version="1.0" encoding="UTF-8"?>\n<jsplugins></jsplugins>\n',
  );
}

function removeExistingJsPluginNodes(root: Element, addinName: string): void {
  const existingNodes = Array.from(
    root.querySelectorAll("jsplugin"),
  ) as Element[];
  const matchingNodes = existingNodes.filter(
    (node) => node.getAttribute("name") === addinName,
  );
  for (const node of matchingNodes) {
    root.removeChild(node);
  }
}

async function registerWPSAddin(
  publishXmlPath: string,
  addin: WPSAddinManifest,
): Promise<void> {
  await ensurePublishXML(publishXmlPath);

  const xmlString = await IOUtils.readUTF8(publishXmlPath);
  const doc = new DOMParser().parseFromString(xmlString, "text/xml");
  const root = doc.documentElement;

  if (!root || root.nodeName !== "jsplugins") {
    throw new Error("Invalid publish.xml: root element must be <jsplugins>.");
  }

  removeExistingJsPluginNodes(root, addin.name);

  const newNode = doc.createElement("jsplugin");
  newNode.setAttribute("url", getWPSAddinDirectoryName(addin));
  newNode.setAttribute("type", addin.type);
  newNode.setAttribute("enable", "enable_dev");
  newNode.setAttribute("install", "null");
  newNode.setAttribute("version", addin.version);
  newNode.setAttribute("name", addin.name);

  root.appendChild(doc.createTextNode("\n  "));
  root.appendChild(newNode);
  root.appendChild(doc.createTextNode("\n"));

  const xml = new XMLSerializer().serializeToString(doc);
  await IOUtils.writeUTF8(publishXmlPath, xml);
}

async function unregisterWPSAddin(
  publishXmlPath: string,
  addinName: string,
): Promise<void> {
  if (!(await IOUtils.exists(publishXmlPath))) {
    return;
  }

  const xmlString = await IOUtils.readUTF8(publishXmlPath);
  const doc = new DOMParser().parseFromString(xmlString, "text/xml");
  const root = doc.documentElement;

  if (!root || root.nodeName !== "jsplugins") {
    return;
  }

  removeExistingJsPluginNodes(root, addinName);

  const xml = new XMLSerializer().serializeToString(doc);
  await IOUtils.writeUTF8(publishXmlPath, xml);
}

async function writeWPSAddinFile(
  targetDir: string,
  asset: WPSAddinAsset,
): Promise<void> {
  const segments = asset.relativePath.split("/");
  const fileName = segments.pop();
  if (!fileName) {
    throw new Error(`Invalid WPS add-in asset path: ${asset.relativePath}`);
  }

  let parentDir = targetDir;
  if (segments.length) {
    parentDir = PathUtils.join(targetDir, ...segments);
    await IOUtils.makeDirectory(parentDir, {
      createAncestors: true,
      ignoreExisting: true,
    });
  }

  const destinationPath = PathUtils.join(parentDir, fileName);
  await IOUtils.writeUTF8(destinationPath, asset.content);
}

function formatInstallError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export async function installWPSAddin(): Promise<WPSAddinInstallResult> {
  try {
    const addin = getWPSAddinManifest();
    const assets = await getWPSAddinAssets(addin);
    const jsaddonsDir = getWPSJsaddonsDir();
    const targetDir = PathUtils.join(
      jsaddonsDir,
      getWPSAddinDirectoryName(addin),
    );
    const publishXmlPath = PathUtils.join(jsaddonsDir, "publish.xml");

    logWpsAddin("install.start", {
      name: addin.name,
      version: addin.version,
      files: assets.length,
      jsaddonsDir,
      targetDir,
      publishXmlPath,
    });

    await IOUtils.makeDirectory(jsaddonsDir, {
      createAncestors: true,
      ignoreExisting: true,
    });

    const existingInstallPaths = await getInstalledWPSAddinPaths(
      jsaddonsDir,
      addin,
    );
    if (existingInstallPaths.length) {
      logWpsAddin("install.remove-existing-addins", {
        existingInstallPaths,
      });
      await removeInstalledWPSAddinPaths(existingInstallPaths);
    }

    await IOUtils.makeDirectory(targetDir, {
      createAncestors: true,
      ignoreExisting: true,
    });

    await Promise.all(
      assets.map((asset) => writeWPSAddinFile(targetDir, asset)),
    );

    await registerWPSAddin(publishXmlPath, addin);

    logWpsAddin("install.complete", {
      targetDir,
      files: assets.length,
      publishXmlPath,
    });
    return {
      success: true,
      targetDir,
    };
  } catch (error) {
    logWpsAddinError("install.failed", error);
    return {
      success: false,
      message: formatInstallError(error),
    };
  }
}

export async function uninstallWPSAddin(): Promise<WPSAddinUninstallResult> {
  try {
    const addin = getWPSAddinManifest();
    const jsaddonsDir = getWPSJsaddonsDir();
    const publishXmlPath = PathUtils.join(jsaddonsDir, "publish.xml");

    logWpsAddin("uninstall.start", {
      name: addin.name,
      version: addin.version,
      jsaddonsDir,
      publishXmlPath,
    });

    if (!(await IOUtils.exists(jsaddonsDir))) {
      logWpsAddin("uninstall.skip.missing-jsaddons-dir", { jsaddonsDir });
      return {
        success: true,
        removedDirs: [],
      };
    }

    const removedDirs = await getInstalledWPSAddinPaths(jsaddonsDir, addin);
    if (removedDirs.length) {
      logWpsAddin("uninstall.remove-existing-addins", {
        removedDirs,
      });
      await removeInstalledWPSAddinPaths(removedDirs);
    }

    await unregisterWPSAddin(publishXmlPath, addin.name);

    logWpsAddin("uninstall.complete", {
      removedDirs,
      removedCount: removedDirs.length,
    });
    return {
      success: true,
      removedDirs,
    };
  } catch (error) {
    logWpsAddinError("uninstall.failed", error);
    return {
      success: false,
      message: formatInstallError(error),
    };
  }
}

// ── Word Add-in public API ───────────────────────────────────

export async function installWordAddin(): Promise<WordAddinInstallResult> {
  try {
    logWordAddin("install.start", {
      manifestUrl: WORD_ADDIN_MANIFEST_URL,
      os: Services.appinfo.OS,
    });

    const { addinId, manifestContent } = await getWordAddinManifestContent();
    assertManagedWordCatalogIdMatchesManifest(addinId);
    let manifestPath: string;

    switch (Services.appinfo.OS) {
      case "WINNT":
        manifestPath = await installWordAddinOnWindows(
          addinId,
          manifestContent,
        );
        break;
      case "Darwin":
        manifestPath = await installWordAddinOnMac(addinId, manifestContent);
        break;
      default:
        throw new Error(
          "Microsoft Word add-in sideloading is supported only on Windows and macOS.",
        );
    }

    return {
      success: true,
      manifestId: addinId,
      manifestPath,
    };
  } catch (error) {
    logWordAddinError("install.failed", error);
    return {
      success: false,
      message: formatInstallError(error),
    };
  }
}

export async function uninstallWordAddin(): Promise<WordAddinUninstallResult> {
  try {
    logWordAddin("uninstall.start", {
      manifestUrl: WORD_ADDIN_MANIFEST_URL,
      os: Services.appinfo.OS,
    });

    let removedPath: string | null;
    let target: string;

    switch (Services.appinfo.OS) {
      case "WINNT":
        removedPath = await removeWordAddinFromWindows();
        target = "windows-shared-catalog";
        break;
      case "Darwin":
        removedPath = await removeWordAddinFromMac();
        target = "mac-wef";
        break;
      default:
        logWordAddin("uninstall.skip.unsupported-os", {
          os: Services.appinfo.OS,
        });
        return { success: true, removedPath: null };
    }

    logWordAddin("uninstall.complete", {
      removedPath,
      target,
    });

    return {
      success: true,
      removedPath,
    };
  } catch (error) {
    logWordAddinError("uninstall.failed", error);
    return {
      success: false,
      message: formatInstallError(error),
    };
  }
}
