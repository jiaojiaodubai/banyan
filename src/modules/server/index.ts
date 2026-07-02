import type { IO as CitationDialogIO } from "../../dialogs/citationDialog";
import type { IO as BibliographyDialogIO } from "../../dialogs/bibliographyDialog";
import type { IO as StyleDialogIO } from "../../dialogs/styleDialog";
import type {
  BibliographyRequestData,
  BibliographyResponseData,
  CitationRequestData,
  CitationResponseData,
  ConvertRequestData,
  ErrorCode,
  HttpPath,
  ProgressRequestData,
  RefreshRequestData,
  ResponsePayload,
  RouteTable,
  ShowInLibraryRequestData,
  StyleIdentifier,
  StyleResponseData,
} from "../../../typings/server";
import { getPref, setPref } from "../../utils/prefs";
import { getStyle } from "../styles";
import { ProgressBar } from "../../utils/progressBar";
import type { CitationContext, Cite } from "../../../typings/style";
import { toBanyanItem } from "../../utils/item";
import {
  scanInaccessibleItems,
  showInaccessibleItemsDialog,
  importInaccessibleItems,
} from "../inaccessibleItems";
import { convertCitationFields } from "../converter";
import type { CallbackStyle } from "../sandbox";
import {
  enableBanyanCORS,
  restoreBanyanCORS as restoreBanyanCORSPatch,
} from "./corsPatch";
import {
  acquireDocumentLock,
  acquireStyleLock,
  withDocumentLock,
} from "./documentLock";
export { restoreBanyanCORSPatch as restoreBanyanCORS };

type EndpointData<P extends HttpPath> = RouteTable[P]["req"] extends never
  ? undefined
  : RouteTable[P]["req"] | undefined;

type JsonEndpointRequest<P extends HttpPath> = {
  method: "GET" | "POST";
  pathname: string;
  pathParams: Record<string, string>;
  searchParams: URLSearchParams;
  headers: Record<string, string>;
  data: EndpointData<P>;
};

type JsonEndpointResult<P extends HttpPath> = {
  status: number;
  body: ResponsePayload<P>;
};

type JsonEndpointHandler<P extends HttpPath> = (
  request: JsonEndpointRequest<P>,
) => Promise<JsonEndpointResult<P>> | JsonEndpointResult<P>;
type JsonEndpointCallback<P extends HttpPath> = (
  result: JsonEndpointResult<P>,
) => void;
type JsonEndpointCallbackHandler<P extends HttpPath> = (
  request: Pick<JsonEndpointRequest<P>, "data">,
  send: JsonEndpointCallback<P>,
) => void;

const WPS_CONFIG_FILE = "Banyan-for-WPS-Config.cfg";
const WPS_CONFIG_PORT_KEY = "port";
const WPS_CONFIG_TOKEN_KEY = "token";
const ROOT_PATH = "banyan";
const MAIN_WINDOW_READY_TIMEOUT_MS = 5000;
const BANYAN_CLIENT_HEADER = "x-banyan-client";
const BANYAN_TOKEN_HEADER = "x-banyan-token";
const PAIRABLE_ORIGIN_PATTERN =
  /^https?:\/\/(?:localhost|(?:\[[0-9a-f:.]+\])|[a-z0-9.-]+)(?::\d{1,5})?$/i;
const SERVER_AUTH_TOKEN_PREF = "serverAuthToken";
const TRUSTED_ORIGINS_PREF = "serverTrustedOrigins";
const MAX_JSON_BODY_BYTES = 20 * 1024 * 1024;
const RATE_LIMIT_WINDOW_MS = 10_000;
const RATE_LIMIT_MAX_REQUESTS = 80;
const AUTH_PROMPT_COOLDOWN_MS = 60_000;
const EPHEMERAL_REQUEST_STATE_MAX_ENTRIES = 1_000;
const PUBLIC_ENDPOINTS = new Set<HttpPath>(["hello"]);
type TrustedOriginEntry = {
  origin: string;
  clientName: string;
  grantedAt: number;
  lastSeenAt: number;
};

type RateLimitBucket = {
  windowStartedAt: number;
  count: number;
};

// Global progress bar instance for endpoints
const progressBar = new ProgressBar();

// Window throttling: track open dialog windows per document to prevent duplicates
// Key format: `${documentId}:${dialogType}` where dialogType is 'style' | 'citation' | 'bibliography'
// This allows multiple documents to have dialogs open simultaneously,
// but prevents a single document from opening duplicate dialogs
const openWindowsByDocument = new Map<string, Window>();

const rateLimitBuckets = new Map<string, RateLimitBucket>();
const authPromptCooldownByOrigin = new Map<string, number>();

type ZoteroMainWindow = Window & {
  ZoteroPane: {
    collectionsView?: unknown;
    selectItem(
      itemID: number,
      options?: { inLibraryRoot?: boolean },
    ): Promise<boolean>;
  };
};

function getHeader(
  headers: Record<string, string> | undefined,
  name: string,
): string {
  return headers?.[name.toLowerCase()]?.trim() ?? "";
}

function getRequestOrigin(headers: Record<string, string>): string {
  return getHeader(headers, "origin");
}

function isPairableOrigin(origin: string): boolean {
  return PAIRABLE_ORIGIN_PATTERN.test(origin);
}

function getClientName(headers: Record<string, string>): string {
  const raw = getHeader(headers, BANYAN_CLIENT_HEADER);
  const cleaned = raw.replace(/[^\w .:@/-]/g, "").trim();
  return cleaned.slice(0, 80) || "Unknown client";
}

function getServerAuthToken(): string {
  const current = getPref(SERVER_AUTH_TOKEN_PREF).trim();
  if (current) {
    return current;
  }

  const next = crypto.randomUUID();
  setPref(SERVER_AUTH_TOKEN_PREF, next);
  return next;
}

function hasValidServerAuthToken(headers: Record<string, string>): boolean {
  const provided = getHeader(headers, BANYAN_TOKEN_HEADER);
  return Boolean(provided && provided === getServerAuthToken());
}

function loadTrustedOrigins(): TrustedOriginEntry[] {
  return JSON.parse(getPref(TRUSTED_ORIGINS_PREF)) as TrustedOriginEntry[];
}

function saveTrustedOrigins(entries: TrustedOriginEntry[]): void {
  setPref(TRUSTED_ORIGINS_PREF, JSON.stringify(entries));
}

function findTrustedOrigin(origin: string): TrustedOriginEntry | undefined {
  return loadTrustedOrigins().find((entry) => entry.origin === origin);
}

function touchTrustedOrigin(origin: string): void {
  const entries = loadTrustedOrigins();
  const entry = entries.find((item) => item.origin === origin);
  if (!entry) {
    return;
  }

  const now = Date.now();
  if (now - entry.lastSeenAt < 60_000) {
    return;
  }
  entry.lastSeenAt = now;
  saveTrustedOrigins(entries);
}

function addTrustedOrigin(origin: string, clientName: string): void {
  const now = Date.now();
  const entries = loadTrustedOrigins().filter(
    (entry) => entry.origin !== origin,
  );
  entries.push({
    origin,
    clientName,
    grantedAt: now,
    lastSeenAt: now,
  });
  saveTrustedOrigins(entries);
}

function pruneRateLimitBuckets(now: number): void {
  if (rateLimitBuckets.size < EPHEMERAL_REQUEST_STATE_MAX_ENTRIES) {
    return;
  }

  for (const [key, bucket] of rateLimitBuckets) {
    if (now - bucket.windowStartedAt >= RATE_LIMIT_WINDOW_MS) {
      rateLimitBuckets.delete(key);
    }
  }
}

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  pruneRateLimitBuckets(now);

  const bucket = rateLimitBuckets.get(key);
  if (!bucket || now - bucket.windowStartedAt >= RATE_LIMIT_WINDOW_MS) {
    rateLimitBuckets.set(key, { windowStartedAt: now, count: 1 });
    return true;
  }

  bucket.count += 1;
  return bucket.count <= RATE_LIMIT_MAX_REQUESTS;
}

function getRateLimitKey(
  headers: Record<string, string>,
  path: string,
): string {
  const origin = getRequestOrigin(headers);
  if (origin) {
    return `origin:${origin}:${path}`;
  }
  const client = getClientName(headers);
  return `client:${client || "unknown"}:${path}`;
}

function pruneAuthPromptCooldowns(now: number): void {
  if (authPromptCooldownByOrigin.size < EPHEMERAL_REQUEST_STATE_MAX_ENTRIES) {
    return;
  }

  for (const [origin, lastPromptAt] of authPromptCooldownByOrigin) {
    if (now - lastPromptAt >= AUTH_PROMPT_COOLDOWN_MS) {
      authPromptCooldownByOrigin.delete(origin);
    }
  }
}

function confirmUnknownOriginAccess(
  origin: string,
  clientName: string,
): boolean {
  const now = Date.now();
  pruneAuthPromptCooldowns(now);

  const lastPromptAt = authPromptCooldownByOrigin.get(origin) || 0;
  if (now - lastPromptAt < AUTH_PROMPT_COOLDOWN_MS) {
    return false;
  }

  const message = [
    `${clientName} is requesting access to Banyan's local endpoints.`,
    "",
    `Origin: ${origin}`,
    "",
    "Allow this origin to send Banyan integration requests?",
  ].join("\n");

  try {
    const allowed = Services.prompt.confirm(
      Zotero.getMainWindow() as unknown as mozIDOMWindowProxy,
      addon.data.config.addonName,
      message,
    );
    if (allowed) {
      addTrustedOrigin(origin, clientName);
    } else {
      authPromptCooldownByOrigin.set(origin, now);
    }
    return allowed;
  } catch (error) {
    ztoolkit.logError(error);
    return false;
  }
}

function responseAuthError<P extends HttpPath>(
  status: number,
  message: string,
): JsonEndpointResult<P> {
  return json(status, responseError<P>(`http_${status}`, message));
}

function authorizeJsonEndpointRequest<P extends HttpPath>(
  path: P,
  headers: Record<string, string>,
): JsonEndpointResult<P> | null {
  if (PUBLIC_ENDPOINTS.has(path)) {
    return null;
  }

  const rateLimitKey = getRateLimitKey(headers, path);
  if (!checkRateLimit(rateLimitKey)) {
    return responseAuthError<P>(429, "Too many Banyan requests");
  }

  if (hasValidServerAuthToken(headers)) {
    return null;
  }

  const origin = getRequestOrigin(headers);
  if (!origin || origin === "null") {
    return responseAuthError<P>(
      403,
      "Banyan endpoints require a trusted Origin or valid token",
    );
  }

  if (!isPairableOrigin(origin)) {
    return responseAuthError<P>(
      403,
      "Banyan endpoints require a valid token for this Origin",
    );
  }

  const trusted = findTrustedOrigin(origin);
  if (trusted) {
    touchTrustedOrigin(origin);
    return null;
  }

  const clientName = getClientName(headers);
  if (confirmUnknownOriginAccess(origin, clientName)) {
    return null;
  }

  return responseAuthError<P>(403, "Banyan origin is not trusted");
}

function isReadyMainWindow(window: Window | null): window is ZoteroMainWindow {
  return Boolean(
    window &&
    !window.closed &&
    (window as Partial<ZoteroMainWindow>).ZoteroPane?.collectionsView,
  );
}

async function waitForReadyMainWindow(
  timeoutMs = MAIN_WINDOW_READY_TIMEOUT_MS,
): Promise<ZoteroMainWindow> {
  if (!Zotero.getMainWindow()) {
    Zotero.openMainWindow();
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const mainWindow = Zotero.getMainWindow();
    if (isReadyMainWindow(mainWindow)) {
      return mainWindow;
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 50);
    });
  }

  throw new Error("Timed out waiting for Zotero main window");
}

async function getItemByStrictUri(uri: string): Promise<Zotero.Item | null> {
  const item = await Zotero.URI.getURIItem(uri);
  if (!item || item.deleted) {
    return null;
  }

  return Zotero.URI.getItemURI(item) === uri ? item : null;
}

function summarizeUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  try {
    const record = error as
      | {
          name?: unknown;
          message?: unknown;
          result?: unknown;
          filename?: unknown;
          lineNumber?: unknown;
        }
      | undefined;
    const parts = [
      typeof record?.name === "string" ? record.name : undefined,
      typeof record?.message === "string" ? record.message : undefined,
      record?.result !== undefined
        ? `result=${String(record.result)}`
        : undefined,
      typeof record?.filename === "string"
        ? `file=${record.filename}`
        : undefined,
      record?.lineNumber !== undefined
        ? `line=${String(record.lineNumber)}`
        : undefined,
    ].filter(Boolean);
    if (parts.length) {
      return parts.join(" ");
    }
  } catch {
    // Fall through to String(error).
  }

  return String(error);
}

function buildRefreshFailureResult(
  requestStartedAt: number,
  error: unknown,
): JsonEndpointResult<"refresh"> {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const isStyleOutputError =
    errorMessage.includes("has no return value") ||
    errorMessage.includes("returned invalid value") ||
    errorMessage.includes("timed out after");

  if (isStyleOutputError) {
    // Surface style-script contract failures to frontend as 4xx errors.
    ztoolkit.logError(error);
    return json(400, responseError<"refresh">("invalid_params", errorMessage));
  }

  ztoolkit.logError(
    `[server] refresh.internal-error elapsedMs=${Date.now() - requestStartedAt} message=${summarizeUnknownError(error)}`,
  );
  return json(
    500,
    responseError<"refresh">(
      "internal_error",
      "Failed to refresh citations and bibliography",
    ),
  );
}

/**
 * Get Zotero item with fallback for merged items.
 * Implements the same logic as Zotero.Integration.URIMap.prototype.getZoteroItemForURIs
 * to support duplicate item merging.
 *
 * @param itemId - The item ID from citation
 * @param itemUri - The item URI from citation (optional)
 * @returns The Zotero item, or null if not found
 */
async function getItemWithMergeFallback(
  itemId: number,
  itemUri?: string,
): Promise<Zotero.Item | null> {
  let item: Zotero.Item | null = null;

  // First try: use URI if available
  if (itemUri) {
    try {
      const itemFromUri = await Zotero.URI.getURIItem(itemUri);
      if (itemFromUri && !itemFromUri.deleted) {
        item = itemFromUri;
        return item;
      }
    } catch {
      // URI resolution failed, continue to fallback
    }

    // Second try: check if this item was replaced by another (merged items)
    try {
      const replacers = await Zotero.Relations.getByPredicateAndObject(
        "item",
        Zotero.Relations.replacedItemPredicate,
        itemUri,
      );
      if (replacers.length && !replacers[0].deleted) {
        item = replacers[0];
        return item;
      }
    } catch (e) {
      ztoolkit.logError(e);
    }
  }

  // Final fallback: try to get by ID
  try {
    const itemById = await Zotero.Items.getAsync(itemId);
    if (itemById && !itemById.deleted) {
      item = itemById;
    }
  } catch {
    // Item not found or error
  }

  return item;
}

function getDialogRaiseFeature(): string {
  if (
    !Zotero.isMac &&
    Zotero.Prefs.get("integration.keepAddCitationDialogRaised")
  ) {
    return ",popup";
  }
  return ",alwaysRaised";
}

function getCommonDialogFeatures(): string {
  let features = "chrome,centerscreen";
  if (Zotero.isLinux) {
    features += ",dialog=no";
  }
  return features;
}

export function openDialogWindow<T extends object>(
  url: string,
  features: string,
  io: T,
): Window {
  return Services.ww.openWindow(
    // @ts-expect-error Services.ww.openWindow has incomplete type definitions
    null,
    url,
    "",
    `${getCommonDialogFeatures()},${features}`,
    { wrappedJSObject: io },
  ) as Window;
}

function responseOk<P extends HttpPath>(
  data: RouteTable[P]["res"],
): ResponsePayload<P> {
  return { ok: true, data } as ResponsePayload<P>;
}

function responseError<P extends HttpPath>(
  code: ErrorCode,
  message: string,
): ResponsePayload<P> {
  return { ok: false, error: { code, message } } as ResponsePayload<P>;
}

function json<P extends HttpPath>(
  status: number,
  body: ResponsePayload<P>,
): JsonEndpointResult<P> {
  return { status, body };
}

/**
 * Registers a strongly-typed JSON endpoint while preserving Zotero's runtime contract.
 *
 * Why this wrapper exists:
 * - Zotero.Server.RequestHandler instantiates handlers via `new this.endpoint`.
 * - It reads instance properties `supportedMethods` and `supportedDataTypes`.
 * - It dispatches init using `endpoint.init.length` (1-arg, 2-arg, or 3-arg mode).
 *
 * Therefore we still register a class with an instance `init` method, but we expose
 * a function-based, path-typed API to improve readability and enforce route IO types.
 */
function registerJsonEndpoint<P extends HttpPath>(
  path: P,
  handler: JsonEndpointHandler<P>,
  options?: {
    supportedMethods?: string[];
    supportedDataTypes?: string[] | "*";
  },
): void {
  const supportedMethods = options?.supportedMethods ?? ["POST"];
  const supportedDataTypes = options?.supportedDataTypes ?? [
    "application/json",
  ];

  Zotero.Server.Endpoints[`/${ROOT_PATH}/${path}`] = class {
    supportedMethods = supportedMethods;
    supportedDataTypes = supportedDataTypes;

    async init(request: JsonEndpointRequest<P>) {
      const authError = authorizeJsonEndpointRequest(path, request.headers);
      if (authError) {
        return [
          authError.status,
          "application/json",
          JSON.stringify(authError.body),
        ];
      }

      const result = await handler(request);
      return [result.status, "application/json", JSON.stringify(result.body)];
    }
  };
}

function registerJsonCallbackEndpoint<P extends HttpPath>(
  path: P,
  handler: JsonEndpointCallbackHandler<P>,
  options?: {
    supportedMethods?: string[];
    supportedDataTypes?: string[] | "*";
  },
): void {
  const supportedMethods = options?.supportedMethods ?? ["POST"];
  const supportedDataTypes = options?.supportedDataTypes ?? [
    "application/json",
  ];

  Zotero.Server.Endpoints[`/${ROOT_PATH}/${path}`] = class {
    supportedMethods = supportedMethods;
    supportedDataTypes = supportedDataTypes;

    init(request: JsonEndpointRequest<P>) {
      return new Promise<[number, string, string]>((resolve) => {
        const send: JsonEndpointCallback<P> = (result) => {
          resolve([
            result.status,
            "application/json",
            JSON.stringify(result.body),
          ]);
        };

        try {
          const authError = authorizeJsonEndpointRequest(path, request.headers);
          if (authError) {
            send(authError);
            return;
          }

          handler({ data: request.data }, send);
        } catch (error) {
          ztoolkit.logError(error);
          send(json(500, responseError<P>("internal_error", "Internal error")));
        }
      });
    }
  };
}

function handleRefreshRequest(
  { data }: Pick<JsonEndpointRequest<"refresh">, "data">,
  send: JsonEndpointCallback<"refresh">,
): void {
  const requestStartedAt = Date.now();

  if (
    !data ||
    !data.documentId ||
    !data.style ||
    !Array.isArray(data.contexts)
  ) {
    ztoolkit.logError("[server] refresh.invalid-payload");
    send(
      json(
        400,
        responseError<"refresh">(
          "invalid_params",
          "Refresh request must include documentId, style and contexts",
        ),
      ),
    );
    return;
  }

  const refreshData = data as RefreshRequestData;
  const documentId = refreshData.documentId;
  let settled = false;
  let releaseLock: (() => void) | undefined;
  let releaseStyleLock: (() => void) | undefined;

  const finish = (result: JsonEndpointResult<"refresh">) => {
    if (settled) {
      ztoolkit.logError("[server] refresh.finish.duplicate");
      return;
    }
    settled = true;
    try {
      releaseStyleLock?.();
    } finally {
      try {
        releaseLock?.();
      } finally {
        send(result);
      }
    }
  };

  const finishWithError = (error: unknown) => {
    finish(buildRefreshFailureResult(requestStartedAt, error));
  };

  void (async () => {
    try {
      releaseLock = await acquireDocumentLock(documentId);
      releaseStyleLock = await acquireStyleLock(refreshData.style.id);

      const style = await getStyle(refreshData.style);

      const inaccessibleItems = await scanInaccessibleItems(
        refreshData.contexts,
      );

      let importedItemsMap = new Map<string, Zotero.Item>();
      if (inaccessibleItems.length > 0) {
        const userChoice = await showInaccessibleItemsDialog(inaccessibleItems);

        if (userChoice === "cancel") {
          finish(
            json(
              400,
              responseError<"refresh">(
                "cancelled",
                "Refresh cancelled by user due to inaccessible items",
              ),
            ),
          );
          return;
        }

        if (userChoice === "import") {
          importedItemsMap = await importInaccessibleItems(inaccessibleItems);
        }
      }

      const contexts = await Promise.all(
        refreshData.contexts.map(async (context: CitationContext) => {
          const cites = await Promise.all(
            context.cites.map(async (cite: Cite) => {
              try {
                let item: Zotero.Item | null = null;

                if (cite.item.uri && importedItemsMap.has(cite.item.uri)) {
                  item = importedItemsMap.get(cite.item.uri)!;
                } else {
                  item = await getItemWithMergeFallback(
                    cite.item.id,
                    cite.item.uri,
                  );
                }

                if (item) {
                  cite.item = toBanyanItem(item);
                }
                return cite;
              } catch (error) {
                ztoolkit.logError(error);
                return cite;
              }
            }),
          );
          context.cites = cites;

          return context;
        }),
      );

      const generateWithCallbacks = (style as CallbackStyle)
        .__banyanGenerateWithCallbacks;
      if (typeof generateWithCallbacks !== "function") {
        throw new Error("Style callback bridge is unavailable for refresh.");
      }

      generateWithCallbacks(contexts, {
        resolve: ({ citations, bibliography }) => {
          finish(json(200, responseOk<"refresh">({ citations, bibliography })));
        },
        reject: finishWithError,
      });
    } catch (error) {
      finishWithError(error);
    }
  })();
}

/**
 * Register all Banyan endpoints on Zotero.Server
 * Should be called once during plugin initialization
 */
export function registerEndpoints(): void {
  // Enable CORS before registering endpoints
  enableBanyanCORS({
    rootPath: ROOT_PATH,
    maxJsonBodyBytes: MAX_JSON_BODY_BYTES,
    getHeader,
    responseError,
  });

  registerJsonEndpoint("hello", async () => {
    return json(200, responseOk<"hello">("Hello from Banyan server!"));
  });

  registerJsonEndpoint("showInLibrary", async ({ data }) => {
    try {
      const uri = (data as ShowInLibraryRequestData | undefined)?.uri?.trim();
      if (!uri) {
        return json(
          400,
          responseError<"showInLibrary">("invalid_params", "uri is required"),
        );
      }

      const item = await getItemByStrictUri(uri);
      if (!item) {
        return json(
          404,
          responseError<"showInLibrary">(
            "http_404",
            "Item not found for the provided uri",
          ),
        );
      }

      const mainWindow = await waitForReadyMainWindow();
      const shown = await mainWindow.ZoteroPane.selectItem(item.id, {
        inLibraryRoot: true,
      });

      if (!shown) {
        ztoolkit.logError(
          `[server] show-in-library.item.select.failed uri=${uri} itemID=${item.id}`,
        );
        return json(
          409,
          responseError<"showInLibrary">(
            "http_409",
            "Item matched the provided uri but could not be selected",
          ),
        );
      }

      // @ts-expect-error activate is not typed
      Zotero.Utilities.Internal.activate(mainWindow);
      mainWindow.focus();
      return json(200, responseOk<"showInLibrary">({ uri, shown: true }));
    } catch (e) {
      ztoolkit.logError(e);
      return json(
        500,
        responseError<"showInLibrary">(
          "internal_error",
          "Failed to show item in library",
        ),
      );
    }
  });

  registerJsonEndpoint("style", async ({ data }) => {
    if (!data?.documentId) {
      return json(
        400,
        responseError<"style">("invalid_params", "documentId is required"),
      );
    }

    const documentId = data.documentId;

    return withDocumentLock(documentId, async () => {
      try {
        const styleData = "id" in data ? data : undefined;
        const result = await openStyleDialog(styleData, documentId);
        return json(200, responseOk<"style">(result));
      } catch (e) {
        ztoolkit.logError(e);
        return json(
          500,
          responseError<"style">(
            "dialog_open_failed",
            "Failed to open style dialog",
          ),
        );
      }
    });
  });

  registerJsonEndpoint("citation", async ({ data }) => {
    if (!data) {
      return json(
        400,
        responseError<"citation">(
          "invalid_params",
          "Citation request data is required",
        ),
      );
    }

    const documentId = data.documentId;

    return withDocumentLock(documentId, async () => {
      try {
        const result = await openCitationDialog(data);
        return json(200, responseOk<"citation">(result));
      } catch (e) {
        ztoolkit.logError(e);
        return json(
          500,
          responseError<"citation">(
            "dialog_open_failed",
            "Failed to open citation dialog",
          ),
        );
      }
    });
  });

  registerJsonEndpoint("bibliography", async ({ data }) => {
    if (!data) {
      return json(
        400,
        responseError<"bibliography">(
          "invalid_params",
          "Bibliography request data is required",
        ),
      );
    }

    const documentId = data.documentId;

    return withDocumentLock(documentId, async () => {
      try {
        const result = await openBibliographyDialog(data);
        return json(200, responseOk<"bibliography">(result));
      } catch (e) {
        ztoolkit.logError(e);
        return json(
          500,
          responseError<"bibliography">(
            "dialog_open_failed",
            "Failed to open bibliography dialog",
          ),
        );
      }
    });
  });

  registerJsonCallbackEndpoint("refresh", handleRefreshRequest);

  registerJsonEndpoint("convert", async ({ data }) => {
    if (!data?.documentId) {
      return json(
        400,
        responseError<"convert">("invalid_params", "documentId is required"),
      );
    }

    if (
      (data as ConvertRequestData).citationType !== "intext-citation" &&
      (data as ConvertRequestData).citationType !== "note-citation"
    ) {
      return json(
        400,
        responseError<"convert">(
          "invalid_params",
          "citationType must be 'intext-citation' or 'note-citation'",
        ),
      );
    }

    if (!Array.isArray((data as ConvertRequestData).fields)) {
      return json(
        400,
        responseError<"convert">("invalid_params", "fields must be an array"),
      );
    }

    const documentId = data.documentId;

    return withDocumentLock(documentId, async () => {
      try {
        const result = await convertCitationFields(data as ConvertRequestData);
        return json(200, responseOk<"convert">(result));
      } catch (e) {
        ztoolkit.logError(e);
        return json(
          500,
          responseError<"convert">(
            "internal_error",
            "Failed to convert citation fields",
          ),
        );
      }
    });
  });

  registerJsonEndpoint("progress", async ({ data }) => {
    try {
      const progressData = data as ProgressRequestData | undefined;
      const action = progressData?.action;

      if (action === "open") {
        progressBar.open();
        return json(
          200,
          responseOk<"progress">({
            action: "open",
            opened: progressBar.isOpen,
          }),
        );
      }

      if (action === "close") {
        progressBar.close(progressData?.reason ?? "closed_by_request");
        return json(
          200,
          responseOk<"progress">({ action: "close", closed: true }),
        );
      }

      return json(
        400,
        responseError<"progress">(
          "invalid_params",
          "Progress action must be 'open' or 'close'",
        ),
      );
    } catch (e) {
      progressBar.close("progress_action_failed");
      ztoolkit.logError(e);
      return json(
        500,
        responseError<"progress">("internal_error", "Internal error"),
      );
    }
  });
}

/**
 * Saves the port configuration to WPS config file for external integrations
 */
export async function savePortToConfigFile(port: number): Promise<void> {
  try {
    const filePath = PathUtils.join(PathUtils.tempDir, WPS_CONFIG_FILE);
    const token = getServerAuthToken();
    const content = [
      `${WPS_CONFIG_PORT_KEY}=${port}`,
      `${WPS_CONFIG_TOKEN_KEY}=${token}`,
    ].join("\n");
    await IOUtils.writeUTF8(filePath, content);
  } catch (e) {
    ztoolkit.logError(e);
  }
}

/**
 * Opens the style selection dialog.
 * @param style - Optional style identifier
 * @param documentId - Document identifier (file path) for throttling
 * @returns The selected style ID, or null if cancelled
 */
export async function openStyleDialog(
  style: StyleIdentifier | undefined,
  documentId: string,
): Promise<StyleResponseData | null> {
  // Throttle: if this document already has a style dialog open, activate it instead
  const windowKey = `${documentId}:style`;
  const existingWindow = openWindowsByDocument.get(windowKey);

  if (existingWindow && !existingWindow.closed) {
    // @ts-expect-error activate is not typed
    Zotero.Utilities.Internal.activate(existingWindow);
    return null;
  }

  return new Promise((resolve, reject) => {
    const io: StyleDialogIO = { data: style, resolve };
    try {
      const win = openDialogWindow(
        `chrome://${addon.data.config.addonRef}/content/styleDialog.xhtml`,
        `modal,resizable${getDialogRaiseFeature()}`,
        io,
      );
      openWindowsByDocument.set(windowKey, win);

      // Clean up when window closes
      win.addEventListener("unload", () => {
        if (openWindowsByDocument.get(windowKey) === win) {
          openWindowsByDocument.delete(windowKey);
        }
      });

      // @ts-expect-error activate is not typed
      Zotero.Utilities.Internal.activate(win);
    } catch (e) {
      reject(e);
    }
  });
}

export async function openCitationDialog(
  data: CitationRequestData,
): Promise<CitationResponseData | null> {
  // Throttle: if this document already has a citation dialog open, activate it instead
  const windowKey = `${data.documentId}:citation`;
  const existingWindow = openWindowsByDocument.get(windowKey);

  if (existingWindow && !existingWindow.closed) {
    // @ts-expect-error activate is not typed
    Zotero.Utilities.Internal.activate(existingWindow);
    return null;
  }

  return new Promise<CitationResponseData | null>((resolve, reject) => {
    const io: CitationDialogIO = {
      data,
      resolve,
    };
    try {
      const win = openDialogWindow(
        `chrome://${addon.data.config.addonRef}/content/citationDialog.xhtml`,
        `resizable=true${getDialogRaiseFeature()}`,
        io,
      );
      openWindowsByDocument.set(windowKey, win);

      // Clean up when window closes
      win.addEventListener("unload", () => {
        if (openWindowsByDocument.get(windowKey) === win) {
          openWindowsByDocument.delete(windowKey);
        }
      });

      // @ts-expect-error activate is not typed
      Zotero.Utilities.Internal.activate(win);
    } catch (e) {
      reject(e);
    }
  });
}

export async function openBibliographyDialog(
  data: BibliographyRequestData,
): Promise<BibliographyResponseData | null> {
  // Throttle: if this document already has a bibliography dialog open, activate it instead
  const windowKey = `${data.documentId}:bibliography`;
  const existingWindow = openWindowsByDocument.get(windowKey);

  if (existingWindow && !existingWindow.closed) {
    // @ts-expect-error activate is not typed
    Zotero.Utilities.Internal.activate(existingWindow);
    return null;
  }

  return new Promise((resolve, reject) => {
    const io: BibliographyDialogIO = {
      data,
      resolve,
    };
    try {
      const win = openDialogWindow(
        `chrome://${addon.data.config.addonRef}/content/bibliographyDialog.xhtml`,
        `modal,resizable${getDialogRaiseFeature()}`,
        io,
      );
      openWindowsByDocument.set(windowKey, win);

      // Clean up when window closes
      win.addEventListener("unload", () => {
        if (openWindowsByDocument.get(windowKey) === win) {
          openWindowsByDocument.delete(windowKey);
        }
      });

      // @ts-expect-error activate is not typed
      Zotero.Utilities.Internal.activate(win);
    } catch (e) {
      reject(e);
    }
  });
}
