import wpsAddinManifest from "../../addon/content/integration/WPS/addin-manifest.json";

// ── Word Add-in ──────────────────────────────────────────────
const WORD_ADDIN_MANIFEST_URL =
  "https://ftp.zotero-chinese.com/addins/banyan/word/manifest.xml";
// The manifest URL serves a single file; the add-in’s web app is
// hosted under the same base path.

const WORD_INSTALL_DEBUG_SCOPE = "[word-install]";

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

const WPS_INSTALL_DEBUG_SCOPE = "[wps-install]";

function logWPSInstall(stage: string, details?: Record<string, unknown>): void {
  if (details && Object.keys(details).length) {
    ztoolkit.log(WPS_INSTALL_DEBUG_SCOPE, stage, details);
    return;
  }

  ztoolkit.log(WPS_INSTALL_DEBUG_SCOPE, stage);
}

function logWPSInstallError(
  stage: string,
  error: unknown,
  details?: Record<string, unknown>,
): void {
  if (details && Object.keys(details).length) {
    ztoolkit.logError(
      `${WPS_INSTALL_DEBUG_SCOPE} ${stage} ${JSON.stringify(details)}`,
    );
  } else {
    ztoolkit.logError(`${WPS_INSTALL_DEBUG_SCOPE} ${stage}`);
  }

  ztoolkit.logError(error instanceof Error ? error : String(error));
}

// ── Word Add-in helpers ──────────────────────────────────────

function logWordInstall(
  stage: string,
  details?: Record<string, unknown>,
): void {
  if (details && Object.keys(details).length) {
    ztoolkit.log(WORD_INSTALL_DEBUG_SCOPE, stage, details);
  } else {
    ztoolkit.log(WORD_INSTALL_DEBUG_SCOPE, stage);
  }
}

function logWordInstallError(
  stage: string,
  error: unknown,
  details?: Record<string, unknown>,
): void {
  if (details && Object.keys(details).length) {
    ztoolkit.logError(
      `${WORD_INSTALL_DEBUG_SCOPE} ${stage} ${JSON.stringify(details)}`,
    );
  } else {
    ztoolkit.logError(`${WORD_INSTALL_DEBUG_SCOPE} ${stage}`);
  }

  ztoolkit.logError(error instanceof Error ? error : String(error));
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

/**
 * Find the highest Office version directory under LOCALAPPDATA.
 * Returns e.g. "16.0" or null if Office is not detected.
 */
async function findOfficeVersion(): Promise<string | null> {
  const localAppData = Services.env.get("LOCALAPPDATA");
  if (!localAppData) return null;

  const officeRoot = PathUtils.join(localAppData, "Microsoft", "Office");

  if (!(await IOUtils.exists(officeRoot))) return null;

  const children = await IOUtils.getChildren(officeRoot);
  const versionDirs = children
    .map((p) => PathUtils.filename(p))
    .filter((name) => /^\d+\.\d+$/.test(name))
    .sort((a, b) => {
      const [aMajor, aMinor] = a.split(".").map(Number);
      const [bMajor, bMinor] = b.split(".").map(Number);
      if (aMajor !== bMajor) return bMajor - aMajor;
      return bMinor - aMinor;
    });

  return versionDirs[0] ?? null;
}

/**
 * Determine the Word WEF manifest directory for the given add-in id.
 * Returns null if the platform is unsupported.
 */
async function getWordWefDir(addinId: string): Promise<string | null> {
  switch (Services.appinfo.OS) {
    case "WINNT": {
      const version = await findOfficeVersion();
      if (!version) return null;
      return PathUtils.join(
        Services.env.get("LOCALAPPDATA") || "",
        "Microsoft",
        "Office",
        version,
        "Wef",
        addinId,
      );
    }
    case "Darwin":
      return PathUtils.join(
        getHomeDir(),
        "Library",
        "Containers",
        "com.microsoft.Word",
        "Data",
        "Documents",
        "wef",
        addinId,
      );
    default:
      // Linux does not have native Office support
      return null;
  }
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
    logWPSInstallError("asset-read-empty", new Error("Empty bundled asset"), {
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

    logWPSInstall("install-start", {
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
      logWPSInstall("install-remove-existing-addins", {
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

    ztoolkit.log(`Installed WPS add-in to ${targetDir}`);
    logWPSInstall("install-complete", {
      targetDir,
      files: assets.length,
      publishXmlPath,
    });
    return {
      success: true,
      targetDir,
    };
  } catch (error) {
    ztoolkit.logError(error);
    logWPSInstallError("install-failed", error);
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

    logWPSInstall("uninstall-start", {
      name: addin.name,
      version: addin.version,
      jsaddonsDir,
      publishXmlPath,
    });

    if (!(await IOUtils.exists(jsaddonsDir))) {
      logWPSInstall("uninstall-skip-missing-jsaddons-dir", { jsaddonsDir });
      return {
        success: true,
        removedDirs: [],
      };
    }

    const removedDirs = await getInstalledWPSAddinPaths(jsaddonsDir, addin);
    if (removedDirs.length) {
      logWPSInstall("uninstall-remove-existing-addins", {
        removedDirs,
      });
      await removeInstalledWPSAddinPaths(removedDirs);
    }

    await unregisterWPSAddin(publishXmlPath, addin.name);

    ztoolkit.log(
      `Uninstalled WPS add-in entries: ${removedDirs.join(", ") || "(none)"}`,
    );
    logWPSInstall("uninstall-complete", {
      removedDirs,
      removedCount: removedDirs.length,
    });
    return {
      success: true,
      removedDirs,
    };
  } catch (error) {
    ztoolkit.logError(error);
    logWPSInstallError("uninstall-failed", error);
    return {
      success: false,
      message: formatInstallError(error),
    };
  }
}

// ── Word Add-in public API ───────────────────────────────────

export async function installWordAddin(): Promise<WordAddinInstallResult> {
  try {
    logWordInstall("install-start", {
      manifestUrl: WORD_ADDIN_MANIFEST_URL,
    });

    // 1. Download the manifest from the remote URL
    const manifestContent = await Zotero.File.getContentsFromURLAsync(
      WORD_ADDIN_MANIFEST_URL,
    );

    if (!manifestContent || !manifestContent.trim()) {
      throw new Error(`Empty manifest content from ${WORD_ADDIN_MANIFEST_URL}`);
    }

    // 2. Parse the add-in id
    const addinId = parseWordManifestId(manifestContent);
    if (!addinId) {
      throw new Error(
        "Cannot extract <Id> from manifest.xml. The remote manifest may be malformed.",
      );
    }

    logWordInstall("install-manifest-parsed", {
      addinId,
      manifestSize: manifestContent.length,
    });

    // 3. Determine the WEF target directory
    const wefDir = await getWordWefDir(addinId);
    if (!wefDir) {
      throw new Error(
        "Microsoft Word is not detected on this system or your platform is not supported.",
      );
    }

    // 4. Write the manifest
    await IOUtils.makeDirectory(wefDir, {
      createAncestors: true,
      ignoreExisting: true,
    });

    const manifestPath = PathUtils.join(wefDir, "manifest.xml");
    await IOUtils.writeUTF8(manifestPath, manifestContent);

    ztoolkit.log(`Word add-in manifest written to ${manifestPath}`);
    logWordInstall("install-complete", {
      addinId,
      manifestPath,
    });

    return {
      success: true,
      manifestId: addinId,
      manifestPath,
    };
  } catch (error) {
    ztoolkit.logError(error);
    logWordInstallError("install-failed", error);
    return {
      success: false,
      message: formatInstallError(error),
    };
  }
}

export async function uninstallWordAddin(): Promise<WordAddinUninstallResult> {
  try {
    logWordInstall("uninstall-start", {
      manifestUrl: WORD_ADDIN_MANIFEST_URL,
    });

    // 1. Download the manifest to get the add-in id
    let manifestContent: string;
    try {
      manifestContent = await Zotero.File.getContentsFromURLAsync(
        WORD_ADDIN_MANIFEST_URL,
      );
    } catch {
      // If we cannot reach the remote, try to discover installed add-ins
      // by scanning the WEF directory for Banyan-related manifests.
      // For simplicity, we require the remote manifest to be reachable.
      throw new Error(
        `Cannot reach ${WORD_ADDIN_MANIFEST_URL}. Please check your network connection.`,
      );
    }

    if (!manifestContent || !manifestContent.trim()) {
      throw new Error(`Empty manifest content from ${WORD_ADDIN_MANIFEST_URL}`);
    }

    const addinId = parseWordManifestId(manifestContent);
    if (!addinId) {
      throw new Error(
        "Cannot extract <Id> from manifest.xml. The remote manifest may be malformed.",
      );
    }

    // 2. Determine the WEF directory
    const wefDir = await getWordWefDir(addinId);
    if (!wefDir) {
      logWordInstall("uninstall-skip-no-platform");
      return { success: true, removedPath: null };
    }

    // 3. Remove the add-in directory
    let removedPath: string | null = null;
    if (await IOUtils.exists(wefDir)) {
      await IOUtils.remove(wefDir, {
        recursive: true,
        ignoreAbsent: true,
      });
      removedPath = wefDir;
    }

    ztoolkit.log(
      `Word add-in uninstalled: ${removedPath ?? "(was not present)"}`,
    );
    logWordInstall("uninstall-complete", {
      addinId,
      removedPath,
    });

    return {
      success: true,
      removedPath,
    };
  } catch (error) {
    ztoolkit.logError(error);
    logWordInstallError("uninstall-failed", error);
    return {
      success: false,
      message: formatInstallError(error),
    };
  }
}
