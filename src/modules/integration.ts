import wpsAddinManifest from "../../addon/content/integration/WPS/addin-manifest.json";

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

export type WordTemplateInstallResult =
  | {
      success: true;
      targetDir: string;
      targetPath: string;
    }
  | {
      success: false;
      message: string;
    };

export type WordTemplateUninstallResult =
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

// ── Word .dotm template helpers ──────────────────────────────
// Word auto-loads every global template placed in its STARTUP folder, so the
// VBA `Banyan.dotm` add-in can be distributed with the same file-copy model as
// the WPS add-in: bundle the binary in addon/content and copy it into the
// user's Word startup folder on install (no registry catalog, SMB share, or
// elevated PowerShell needed).
const WORD_TEMPLATE_RESOURCE_PATH = "integration/Word/Banyan.dotm";
const WORD_TEMPLATE_FILE_NAME = "Banyan.dotm";
// Default per-user startup folder. Word honors a `STARTUP-PATH` value under
// `HKCU\Software\Microsoft\Office\<version>\Word\Options` as an override.
const WORD_STARTUP_SUB_PATH = ["Microsoft", "Word", "STARTUP"] as const;
// macOS Word reads startup templates from the Office group container.
const WORD_MAC_STARTUP_PATH_SEGMENTS = [
  "Library",
  "Group Containers",
  "UBF8T346G9.Office",
  "User Content",
  "Startup",
  "Word",
] as const;
// Office versions to probe for a `STARTUP-PATH` override; 16.0 covers
// Click-to-Run Microsoft 365 and recent Office 2016+ installations.
const WORD_OFFICE_VERSION_FALLBACKS = ["16.0"] as const;

function logWordTemplate(
  stage: string,
  details?: Record<string, unknown>,
): void {
  void stage;
  void details;
}

function logWordTemplateError(
  stage: string,
  error: unknown,
  details?: Record<string, unknown>,
): void {
  void stage;
  void details;
  ztoolkit.logError(error);
}

function getWordTemplateAssetURL(): string {
  return `chrome://${addon.data.config.addonRef}/content/${WORD_TEMPLATE_RESOURCE_PATH}`;
}

/**
 * Read the `STARTUP-PATH` override under the first installed Office version's
 * Word\Options key, or null when no version sets it.
 */
async function getWindowsWordStartupPathOverrideOrNull(): Promise<
  string | null
> {
  const rootKey = Ci.nsIWindowsRegKey.ROOT_KEY_CURRENT_USER;
  const accessRead = Ci.nsIWindowsRegKey.ACCESS_READ;
  if (rootKey === undefined || accessRead === undefined) {
    return null;
  }

  const versions = await findOfficeVersions();
  for (const version of versions) {
    const key = createWindowsRegKey();
    try {
      key.open(
        rootKey,
        `Software\\Microsoft\\Office\\${version}\\Word\\Options`,
        accessRead,
      );
      if (key.hasValue("STARTUP-PATH")) {
        const value = key.readStringValue("STARTUP-PATH").trim();
        if (value) {
          return value;
        }
      }
    } catch {
      // The Word Options key is absent for this Office version; keep probing.
    } finally {
      try {
        key.close();
      } catch {
        // Ignore close errors for unopened registry keys.
      }
    }
  }
  return null;
}

async function getWindowsWordStartupDir(): Promise<string> {
  const override = await getWindowsWordStartupPathOverrideOrNull();
  if (override) {
    return override;
  }
  return PathUtils.join(getWindowsAppDataDir(), ...WORD_STARTUP_SUB_PATH);
}

function getMacWordStartupDir(): string {
  return PathUtils.join(getHomeDir(), ...WORD_MAC_STARTUP_PATH_SEGMENTS);
}

async function getWordStartupDir(): Promise<string> {
  switch (Services.appinfo.OS) {
    case "WINNT":
      return getWindowsWordStartupDir();
    case "Darwin":
      return getMacWordStartupDir();
    default:
      throw new Error(
        "Word .dotm template installation is supported only on Windows and macOS.",
      );
  }
}

async function installWordTemplateToDir(targetDir: string): Promise<string> {
  await IOUtils.makeDirectory(targetDir, {
    createAncestors: true,
    ignoreExisting: true,
  });

  const targetPath = PathUtils.join(targetDir, WORD_TEMPLATE_FILE_NAME);
  // `Zotero.File.download()` streams bundled chrome:// content to disk through
  // an nsIChannel/pipe, preserving the binary .dotm byte-for-byte.
  await Zotero.File.download(getWordTemplateAssetURL(), targetPath);
  return targetPath;
}

async function removeWordTemplateFromDir(
  targetDir: string,
): Promise<string | null> {
  const targetPath = PathUtils.join(targetDir, WORD_TEMPLATE_FILE_NAME);
  if (!(await IOUtils.exists(targetPath))) {
    return null;
  }
  await IOUtils.remove(targetPath, { ignoreAbsent: true });
  return targetPath;
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

// ── Word template public API ─────────────────────────────────

export async function installWordTemplate(): Promise<WordTemplateInstallResult> {
  try {
    const targetDir = await getWordStartupDir();
    logWordTemplate("install.start", {
      os: Services.appinfo.OS,
      targetDir,
      templateUrl: getWordTemplateAssetURL(),
    });

    const targetPath = await installWordTemplateToDir(targetDir);

    logWordTemplate("install.complete", {
      targetDir,
      targetPath,
    });
    return {
      success: true,
      targetDir,
      targetPath,
    };
  } catch (error) {
    logWordTemplateError("install.failed", error);
    return {
      success: false,
      message: formatInstallError(error),
    };
  }
}

export async function uninstallWordTemplate(): Promise<WordTemplateUninstallResult> {
  try {
    const targetDir = await getWordStartupDir();
    logWordTemplate("uninstall.start", {
      os: Services.appinfo.OS,
      targetDir,
    });

    const removedPath = await removeWordTemplateFromDir(targetDir);

    logWordTemplate("uninstall.complete", {
      removedPath,
      targetDir,
    });
    return {
      success: true,
      removedPath,
    };
  } catch (error) {
    logWordTemplateError("uninstall.failed", error);
    return {
      success: false,
      message: formatInstallError(error),
    };
  }
}
