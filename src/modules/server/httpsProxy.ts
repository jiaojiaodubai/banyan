import { clearPref, getPref, setPref } from "../../utils/prefs";

export const HTTPS_PROXY_PORT = 23120;

const HTTPS_PROXY_STATE_VERSION = 1;
const CERTIFICATE_VALID_DAYS = 825;
const CERTIFICATE_DIRECTORY_NAME = "https-proxy";
const OPENSSL_PATH = "/usr/bin/openssl";
const SECURITY_PATH = "/usr/bin/security";

type HttpsProxyState = {
  version: typeof HTTPS_PROXY_STATE_VERSION;
  password: string;
  certificateNickname: string;
  caCommonName: string;
  serverFingerprint?: string;
  trusted: boolean;
};

type TlsServerSocket = nsIServerSocket & {
  serverCert: nsIX509Cert;
  setSessionTickets(enabled: boolean): void;
  setRequestClientCertificate(mode: number): void;
  setVersionRange(minVersion: number, maxVersion: number): void;
};

type ProxyConnection = {
  close(): void;
};

let tlsServer: TlsServerSocket | null = null;
let upstreamPort: number | null = null;
let startPromise: Promise<number> | null = null;
const connections = new Set<ProxyConnection>();

function logProxyError(error: unknown): void {
  ztoolkit.logError(
    error instanceof Error
      ? error
      : new Error(`[https-proxy] ${String(error)}`),
  );
}

function validateTargetPort(port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid Banyan HTTP server port: ${port}`);
  }
  if (port === HTTPS_PROXY_PORT) {
    throw new Error(
      `Banyan HTTP server port conflicts with HTTPS proxy port ${HTTPS_PROXY_PORT}`,
    );
  }
}

function getCertificateDirectory(): string {
  return PathUtils.join(
    Zotero.DataDirectory.dir,
    "banyan",
    CERTIFICATE_DIRECTORY_NAME,
  );
}

function getCertificatePaths() {
  const directory = getCertificateDirectory();
  return {
    directory,
    caConfig: PathUtils.join(directory, "ca.cnf"),
    caCertificate: PathUtils.join(directory, "ca.crt"),
    caKey: PathUtils.join(directory, "ca.key"),
    caSerial: PathUtils.join(directory, "ca.srl"),
    serverConfig: PathUtils.join(directory, "server.cnf"),
    serverCertificate: PathUtils.join(directory, "server.crt"),
    serverRequest: PathUtils.join(directory, "server.csr"),
    serverKey: PathUtils.join(directory, "server.key"),
    serverPkcs12: PathUtils.join(directory, "server.p12"),
  };
}

function getLoginKeychainPath(): string {
  const home = Services.dirsvc.get("Home", Ci.nsIFile).path;
  return PathUtils.join(home, "Library", "Keychains", "login.keychain-db");
}

function getCertificateDatabase(): nsIX509CertDB {
  return Cc["@mozilla.org/security/x509certdb;1"].getService(Ci.nsIX509CertDB);
}

function createLocalFile(path: string): nsIFile {
  const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
  file.initWithPath(path);
  return file;
}

function loadProxyState(): HttpsProxyState | null {
  const raw = getPref("httpsProxyState").trim();
  if (!raw) return null;

  try {
    const state = JSON.parse(raw) as Partial<HttpsProxyState>;
    if (
      state.version !== HTTPS_PROXY_STATE_VERSION ||
      typeof state.password !== "string" ||
      typeof state.certificateNickname !== "string" ||
      typeof state.caCommonName !== "string" ||
      typeof state.trusted !== "boolean"
    ) {
      return null;
    }
    return state as HttpsProxyState;
  } catch {
    return null;
  }
}

function saveProxyState(state: HttpsProxyState): void {
  setPref("httpsProxyState", JSON.stringify(state));
}

async function runMacCommand(command: string, args: string[]): Promise<void> {
  const result = await Zotero.Utilities.Internal.exec(command, args);
  if (result !== true) {
    throw result instanceof Error
      ? result
      : new Error(`Command failed: ${command}`);
  }
}

async function removeFiles(paths: string[]): Promise<void> {
  await Promise.all(
    paths.map((path) => IOUtils.remove(path, { ignoreAbsent: true })),
  );
}

async function generateCertificateState(): Promise<HttpsProxyState> {
  if (!(await IOUtils.exists(OPENSSL_PATH))) {
    throw new Error(
      `Cannot create Banyan HTTPS certificate: ${OPENSSL_PATH} is unavailable`,
    );
  }

  const paths = getCertificatePaths();
  await IOUtils.makeDirectory(paths.directory, {
    createAncestors: true,
    ignoreExisting: true,
    permissions: 0o700,
  });

  const instanceId = crypto.randomUUID();
  const state: HttpsProxyState = {
    version: HTTPS_PROXY_STATE_VERSION,
    password: crypto.randomUUID().replaceAll("-", ""),
    certificateNickname: `Banyan HTTPS Proxy ${instanceId}`,
    caCommonName: `Banyan Local HTTPS CA ${instanceId}`,
    trusted: false,
  };

  const caConfig = [
    "[req]",
    "distinguished_name = dn",
    "x509_extensions = v3_ca",
    "prompt = no",
    "[dn]",
    `CN = ${state.caCommonName}`,
    "[v3_ca]",
    "basicConstraints = critical, CA:TRUE, pathlen:0",
    "keyUsage = critical, keyCertSign, cRLSign",
    "subjectKeyIdentifier = hash",
    "authorityKeyIdentifier = keyid:always",
    "",
  ].join("\n");
  const serverConfig = [
    "[req]",
    "distinguished_name = dn",
    "prompt = no",
    "[dn]",
    "CN = localhost",
    "[v3_server]",
    "basicConstraints = critical, CA:FALSE",
    "keyUsage = critical, digitalSignature, keyEncipherment",
    "extendedKeyUsage = serverAuth",
    "subjectAltName = @alt_names",
    "[alt_names]",
    "DNS.1 = localhost",
    "IP.1 = 127.0.0.1",
    "IP.2 = ::1",
    "",
  ].join("\n");

  await IOUtils.writeUTF8(paths.caConfig, caConfig);
  await IOUtils.writeUTF8(paths.serverConfig, serverConfig);

  try {
    await runMacCommand(OPENSSL_PATH, ["genrsa", "-out", paths.caKey, "2048"]);
    await runMacCommand(OPENSSL_PATH, [
      "req",
      "-x509",
      "-new",
      "-sha256",
      "-days",
      String(CERTIFICATE_VALID_DAYS),
      "-key",
      paths.caKey,
      "-out",
      paths.caCertificate,
      "-config",
      paths.caConfig,
    ]);
    await runMacCommand(OPENSSL_PATH, [
      "genrsa",
      "-out",
      paths.serverKey,
      "2048",
    ]);
    await runMacCommand(OPENSSL_PATH, [
      "req",
      "-new",
      "-key",
      paths.serverKey,
      "-out",
      paths.serverRequest,
      "-config",
      paths.serverConfig,
    ]);
    await runMacCommand(OPENSSL_PATH, [
      "x509",
      "-req",
      "-in",
      paths.serverRequest,
      "-CA",
      paths.caCertificate,
      "-CAkey",
      paths.caKey,
      "-CAcreateserial",
      "-out",
      paths.serverCertificate,
      "-days",
      String(CERTIFICATE_VALID_DAYS),
      "-sha256",
      "-extfile",
      paths.serverConfig,
      "-extensions",
      "v3_server",
    ]);
    await runMacCommand(OPENSSL_PATH, [
      "pkcs12",
      "-export",
      "-out",
      paths.serverPkcs12,
      "-inkey",
      paths.serverKey,
      "-in",
      paths.serverCertificate,
      "-certfile",
      paths.caCertificate,
      "-name",
      state.certificateNickname,
      "-passout",
      `pass:${state.password}`,
    ]);

    await IOUtils.setPermissions(paths.serverPkcs12, 0o600);
    await IOUtils.setPermissions(paths.caCertificate, 0o600);
    saveProxyState(state);
    return state;
  } finally {
    await removeFiles([
      paths.caConfig,
      paths.caKey,
      paths.caSerial,
      paths.serverConfig,
      paths.serverCertificate,
      paths.serverRequest,
      paths.serverKey,
    ]);
  }
}

function confirmCertificateTrust(): boolean {
  const message = [
    "Word for Mac requires a trusted local HTTPS endpoint to communicate with Banyan.",
    "",
    "Banyan will add a private, installation-specific certificate authority to your login Keychain. It is used only for https://localhost and can be removed when the Word add-in is uninstalled.",
    "",
    "Continue?",
  ].join("\n");
  return Services.prompt.confirm(
    Zotero.getMainWindow() as unknown as mozIDOMWindowProxy,
    addon.data.config.addonName,
    message,
  );
}

async function trustCertificate(
  state: HttpsProxyState,
): Promise<HttpsProxyState> {
  if (state.trusted) return state;
  if (!confirmCertificateTrust()) {
    throw new Error("Banyan HTTPS certificate installation was cancelled");
  }
  if (!(await IOUtils.exists(SECURITY_PATH))) {
    throw new Error(
      `Cannot trust Banyan HTTPS certificate: ${SECURITY_PATH} is unavailable`,
    );
  }

  const paths = getCertificatePaths();
  await runMacCommand(SECURITY_PATH, [
    "add-trusted-cert",
    "-d",
    "-r",
    "trustRoot",
    "-k",
    getLoginKeychainPath(),
    paths.caCertificate,
  ]);

  const trustedState = { ...state, trusted: true };
  saveProxyState(trustedState);
  return trustedState;
}

function findServerCertificate(state: HttpsProxyState): nsIX509Cert | null {
  const certificates = getCertificateDatabase().getCerts();
  if (state.serverFingerprint) {
    const exact = certificates.find(
      (certificate) =>
        certificate.sha256Fingerprint === state.serverFingerprint,
    );
    if (exact) return exact;
  }

  return (
    certificates.find(
      (certificate) =>
        certificate.commonName === "localhost" &&
        certificate.issuerCommonName === state.caCommonName,
    ) ?? null
  );
}

function importServerCertificate(state: HttpsProxyState): nsIX509Cert {
  const existing = findServerCertificate(state);
  if (existing) return existing;

  const paths = getCertificatePaths();
  getCertificateDatabase().importPKCS12File(
    createLocalFile(paths.serverPkcs12),
    state.password,
  );
  const imported = findServerCertificate(state);
  if (!imported) {
    throw new Error(
      "Banyan HTTPS server certificate was not imported into Zotero",
    );
  }

  saveProxyState({
    ...state,
    serverFingerprint: imported.sha256Fingerprint,
  });
  return imported;
}

async function ensureServerCertificate(): Promise<nsIX509Cert> {
  let state = loadProxyState();
  const paths = getCertificatePaths();
  if (!state || !(await IOUtils.exists(paths.serverPkcs12))) {
    state = await generateCertificateState();
  }
  state = await trustCertificate(state);
  return importServerCertificate(state);
}

function bridgeConnection(
  clientTransport: nsISocketTransport,
  targetPort: number,
): void {
  const socketTransportService = Cc[
    "@mozilla.org/network/socket-transport-service;1"
  ].getService(Ci.nsISocketTransportService);
  const targetTransport = socketTransportService.createTransport(
    [],
    "127.0.0.1",
    targetPort,
    null!,
    null!,
  );

  const streams = [
    clientTransport.openInputStream(0, 0, 0),
    clientTransport.openOutputStream(0, 0, 0),
    targetTransport.openInputStream(0, 0, 0),
    targetTransport.openOutputStream(0, 0, 0),
  ] as const;
  let closed = false;
  const connection: ProxyConnection = {
    close() {
      if (closed) return;
      closed = true;
      connections.delete(connection);
      for (const stream of streams) {
        try {
          stream.close();
        } catch {
          // The peer may already have closed its half of the connection.
        }
      }
      try {
        clientTransport.close(Cr.NS_OK);
      } catch {
        // Ignore an already closed transport.
      }
      try {
        targetTransport.close(Cr.NS_OK);
      } catch {
        // Ignore an already closed transport.
      }
    },
  };
  connections.add(connection);

  const onCopyComplete = (status: nsresult) => {
    if (!Components.isSuccessCode(status)) {
      logProxyError(`stream closed with status=${status}`);
    }
    connection.close();
  };

  NetUtil.asyncCopy(streams[0], streams[3], onCopyComplete);
  NetUtil.asyncCopy(streams[2], streams[1], onCopyComplete);
}

function createTlsServer(
  certificate: nsIX509Cert,
  targetPort: number,
): TlsServerSocket {
  const server = Cc["@mozilla.org/network/tls-server-socket;1"].createInstance(
    Ci.nsIServerSocket,
  ) as TlsServerSocket;
  server.init(HTTPS_PROXY_PORT, true, -1);
  server.serverCert = certificate;
  server.setSessionTickets(false);
  server.setRequestClientCertificate(0);
  server.setVersionRange(0x0303, 0x0304);

  const listener: nsIServerSocketListener = {
    QueryInterface: ChromeUtils.generateQI([Ci.nsIServerSocketListener]),
    onSocketAccepted(_socket, transport) {
      try {
        bridgeConnection(transport, targetPort);
      } catch (error) {
        logProxyError(error);
        transport.close(Cr.NS_ERROR_FAILURE);
      }
    },
    onStopListening(_socket, status) {
      if (tlsServer && !Components.isSuccessCode(status)) {
        logProxyError(`listener stopped with status=${status}`);
      }
    },
  };
  server.asyncListen(listener);
  return server;
}

async function startHttpsProxy(targetPort: number): Promise<number> {
  if (tlsServer) {
    if (upstreamPort !== targetPort) {
      throw new Error(
        "Banyan HTTPS proxy is already connected to another port",
      );
    }
    return tlsServer.port;
  }
  if (startPromise) return startPromise;

  startPromise = (async () => {
    const certificate = await ensureServerCertificate();
    const server = createTlsServer(certificate, targetPort);
    tlsServer = server;
    upstreamPort = targetPort;
    ztoolkit.log(
      `[https-proxy] listening port=${server.port} upstream=${targetPort}`,
    );
    return server.port;
  })();

  try {
    return await startPromise;
  } finally {
    startPromise = null;
  }
}

export async function initializeHttpsProxy(
  targetPort: number,
): Promise<number | null> {
  if (!Zotero.isMac || !getPref("httpsProxyEnabled")) return null;
  validateTargetPort(targetPort);
  return startHttpsProxy(targetPort);
}

export async function enableHttpsProxy(targetPort: number): Promise<number> {
  setPref("httpsProxyEnabled", true);
  try {
    const port = await initializeHttpsProxy(targetPort);
    if (port === null) {
      throw new Error(
        "Banyan HTTPS proxy is currently supported only on macOS",
      );
    }
    return port;
  } catch (error) {
    setPref("httpsProxyEnabled", false);
    throw error;
  }
}

export function stopHttpsProxy(): void {
  for (const connection of [...connections]) {
    connection.close();
  }
  const server = tlsServer;
  tlsServer = null;
  upstreamPort = null;
  if (server) {
    try {
      server.close();
    } catch (error) {
      logProxyError(error);
    }
  }
}

export async function disableHttpsProxy(options?: {
  removeCertificate?: boolean;
}): Promise<void> {
  stopHttpsProxy();
  setPref("httpsProxyEnabled", false);
  if (!options?.removeCertificate || !Zotero.isMac) return;

  const state = loadProxyState();
  if (!state) return;

  const certificateDatabase = getCertificateDatabase();
  for (const certificate of certificateDatabase.getCerts()) {
    if (
      certificate.sha256Fingerprint === state.serverFingerprint ||
      certificate.issuerCommonName === state.caCommonName ||
      certificate.commonName === state.caCommonName
    ) {
      certificateDatabase.deleteCertificate(certificate);
    }
  }

  if (state.trusted && (await IOUtils.exists(SECURITY_PATH))) {
    const result = await Zotero.Utilities.Internal.exec(SECURITY_PATH, [
      "delete-certificate",
      "-c",
      state.caCommonName,
      getLoginKeychainPath(),
    ]);
    if (result !== true) {
      logProxyError(result);
    }
  }

  await IOUtils.remove(getCertificateDirectory(), {
    ignoreAbsent: true,
    recursive: true,
  });
  clearPref("httpsProxyState");
}
