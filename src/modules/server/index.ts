import type { IO as CitationDialogIO } from "../../dialogs/citationDialog";
import type { IO as BibliographyDialogIO } from "../../dialogs/bibliographyDialog";
import type { IO as StyleDialogIO } from "../../dialogs/styleDialog";
import type {
  BibliographyRequestData,
  BibliographyResponseData,
  CitationDialogRequestData,
  CitationResponseData,
  ConvertRequestData,
  ErrorCode,
  HttpPath,
  ProgressRequestData,
  RefreshRequestData,
  ResponsePayload,
  RouteTable,
  ShowInLibraryRequestData,
  StyleListEntry,
  StyleRequestData,
  StyleResponseData,
} from "../../../typings/server";
import { getPref, setPref } from "../../utils/prefs";
import { getStyle } from "../styles";
import { ProgressBar } from "../../utils/progressBar";
import {
  activateSingletonDialog,
  BIBLIOGRAPHY_DIALOG_NAME,
  CITATION_DIALOG_NAME,
  getDialogRaiseFeature,
  isWindowAlive,
  openDialogWindow,
  STYLE_DIALOG_NAME,
} from "../../utils/window";
import { syncContextsWithLiveItems } from "../sandbox/items";
import { getStyleFaultCode } from "../sandbox/faults";
import {
  scanInaccessibleItems,
  showInaccessibleItemsDialog,
  importInaccessibleItems,
} from "../inaccessibleItems";
import { convertCitationFields } from "../converter";
import type { CitationContext } from "@banyan/core/types/style";
import { normalizeCitationContexts } from "@banyan/core/validation/contexts";
import {
  enableBanyanCORS,
  restoreBanyanCORS as restoreBanyanCORSPatch,
} from "./corsPatch";
import {
  acquireDocumentLock,
  acquireStyleLock,
  withDocumentLock,
  type LockHandle,
} from "./documentLock";
import { updateCitationColumnFromRefresh } from "../citedItemsSearch";
import { initializeHttpsProxy, stopHttpsProxy } from "./httpsProxy";
import { useL10n } from "../../utils/locale";
import { createLogger } from "../../utils/logger";

const log = createLogger("server");

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

const t = useL10n();

const ROOT_PATH = "banyan";
const MAIN_WINDOW_READY_TIMEOUT_MS = 5000;
const ZOTERO_ALLOWED_REQUEST_HEADER = "zotero-allowed-request";
const BANYAN_CLIENT_HEADER = "x-banyan-client";
const NATIVE_CLIENTS = new Set([
  "Banyan for Agent",
  "Banyan for Word VBA",
  "Banyan for WPS",
]);
const PAIRABLE_ORIGIN_PATTERN =
  /^https?:\/\/(?:localhost|(?:\[[0-9a-f:.]+\])|[a-z0-9.-]+)(?::\d{1,5})?$/i;
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
  return cleaned.slice(0, 80);
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
    t("server-origin-auth-intro", { args: { clientName } }),
    "",
    t("server-origin-auth-origin", { args: { origin } }),
    "",
    t("server-origin-auth-prompt"),
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
    log.warn("authorization prompt failed; denying the request", error);
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

  if (getHeader(headers, ZOTERO_ALLOWED_REQUEST_HEADER) !== "1") {
    return responseAuthError<P>(
      403,
      "Banyan endpoints require Zotero-Allowed-Request: 1",
    );
  }

  const clientName = getClientName(headers);
  if (!clientName) {
    return responseAuthError<P>(
      403,
      "Banyan endpoints require X-Banyan-Client",
    );
  }

  const origin = getRequestOrigin(headers);
  if (!origin) {
    if (NATIVE_CLIENTS.has(clientName)) {
      return null;
    }
    return responseAuthError<P>(403, "Banyan native client is not allowed");
  }

  if (origin.toLowerCase() === "null") {
    return responseAuthError<P>(403, "Banyan endpoints reject Origin: null");
  }

  if (!isPairableOrigin(origin)) {
    return responseAuthError<P>(403, "Banyan Origin is not pairable");
  }

  const trusted = findTrustedOrigin(origin);
  if (trusted) {
    touchTrustedOrigin(origin);
    return null;
  }

  if (confirmUnknownOriginAccess(origin, clientName)) {
    return null;
  }

  return responseAuthError<P>(403, "Banyan origin is not trusted");
}

function isReadyMainWindow(window: Window | null): window is Window & {
  ZoteroPane: Zotero.ZoteroPane & {
    collectionsView: _ZoteroTypes.CollectionTree;
    selectItem: (
      itemID: number,
      options?: { inLibraryRoot?: boolean },
    ) => Promise<boolean>;
  };
} {
  return Boolean(
    window && !window.closed && window.ZoteroPane?.collectionsView,
  );
}

async function waitForReadyMainWindow(
  timeoutMs = MAIN_WINDOW_READY_TIMEOUT_MS,
): Promise<
  Window & {
    ZoteroPane: Zotero.ZoteroPane & {
      collectionsView: _ZoteroTypes.CollectionTree;
      selectItem: (
        itemID: number,
        options?: { inLibraryRoot?: boolean },
      ) => Promise<boolean>;
    };
  }
> {
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

function buildRefreshFailureResult(
  requestStartedAt: number,
  error: unknown,
): JsonEndpointResult<"refresh"> {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const styleFaultCode = getStyleFaultCode(error);

  if (styleFaultCode) {
    // Surface style-script failures to frontend as 4xx errors.
    log.warn(`style script failure (${styleFaultCode})`, error);
    return json(400, responseError<"refresh">("invalid_params", errorMessage));
  }

  log.error(
    `refresh: internal error after ${Date.now() - requestStartedAt}ms`,
    error,
  );
  return json(
    500,
    responseError<"refresh">(
      "internal_error",
      "Failed to refresh citations and bibliography",
    ),
  );
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
 * The wrapper still registers a class with an instance `init` method, while
 * exposing a function-based, path-typed API for route IO types.
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
          log.error("endpoint handler failed", error);
          send(json(500, responseError<P>("internal_error", "Internal error")));
        }
      });
    }
  };
}

async function getStyleList(): Promise<RouteTable["style/list"]["res"]> {
  const summaries = Array.from(addon.data.styles.files.values())
    .map((style): StyleListEntry => ({
      id: style.id,
      title: style.title,
      citationType: style.citationType,
      description: style.description,
      updated: style.updated,
      optionParams: style.optionParams ?? [],
    }))
    .toSorted((a, b) => a.title.localeCompare(b.title));

  return summaries;
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
    log.warn("refresh: invalid payload");
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

  // The core re-checks the same shape and answers `generate-input`; doing it
  // here first turns a bad request into 400 instead of a 500.
  let contexts: CitationContext[];
  try {
    contexts = normalizeCitationContexts(refreshData.contexts);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn("refresh: invalid contexts", error);
    send(json(400, responseError<"refresh">("invalid_params", message)));
    return;
  }

  let settled = false;
  let documentLock: LockHandle | undefined;
  let styleLock: LockHandle | undefined;

  const finish = (result: JsonEndpointResult<"refresh">) => {
    if (settled) {
      log.warn("refresh: finish called twice; ignoring the duplicate");
      return;
    }
    settled = true;
    try {
      styleLock?.release();
    } finally {
      try {
        documentLock?.release();
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
      documentLock = await acquireDocumentLock(documentId);
      styleLock = await acquireStyleLock(refreshData.style.id);

      const style = await getStyle(refreshData.style);
      const shouldSyncItems = refreshData.syncItems !== false;

      if (shouldSyncItems) {
        const inaccessibleItems = await scanInaccessibleItems(contexts);

        let importedItemsMap = new Map<string, Zotero.Item>();
        if (inaccessibleItems.length > 0) {
          const userChoice =
            await showInaccessibleItemsDialog(inaccessibleItems);

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

        contexts = await syncContextsWithLiveItems(contexts, importedItemsMap);
      }

      const { citations, bibliography } = await style.generate(
        contexts,
        refreshData.style.options,
      );

      // The watchdog force-released our lock, so a later request may already
      // own this document/style. Abandon this stale result instead of racing
      // its write-back (both the cited-items search update and the response
      // the front-end applies to the document).
      if (documentLock?.forceReleased || styleLock?.forceReleased) {
        finishWithError(
          new Error(
            "Refresh exceeded the lock watchdog timeout and was superseded",
          ),
        );
        return;
      }

      // The call's synchronous prefix updates the cited-items state and search
      // conditions before `finish()` releases the locks; only the tree repaint
      // is deferred. That repaint reads the live state, so a later refresh can
      // replace it but this one cannot write an older citation set back.
      void updateCitationColumnFromRefresh(
        { documentId, contexts },
        { citations, bibliography },
      ).catch((error) => {
        log.error("citation column update failed", error);
      });
      finish(json(200, responseOk<"refresh">({ citations, bibliography })));
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
        log.warn(
          `showInLibrary: item could not be selected uri=${uri} itemID=${item.id}`,
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
      log.error("showInLibrary failed", e);
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

    const request = data as StyleRequestData;

    return withDocumentLock(request.documentId, async () => {
      try {
        const result = await openStyleDialog(request);
        return json(200, responseOk<"style">(result));
      } catch (e) {
        log.error("style endpoint failed", e);
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

  registerJsonEndpoint("style/list", async () => {
    return json(200, responseOk<"style/list">(await getStyleList()));
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
        log.error("citation endpoint failed", e);
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
        log.error("bibliography endpoint failed", e);
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
        log.error("convert endpoint failed", e);
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
      log.error("progress endpoint failed", e);
      return json(
        500,
        responseError<"progress">("internal_error", "Internal error"),
      );
    }
  });
}

export async function initializeServer(): Promise<void> {
  registerEndpoints();

  try {
    const httpPort = Number(Zotero.Prefs.get("httpServer.port"));
    await initializeHttpsProxy(httpPort);
  } catch (error) {
    log.error("HTTPS proxy initialization failed", error);
  }
}

export function shutdownServer(): void {
  stopHttpsProxy();
  restoreBanyanCORSPatch();
  unregisterEndpoints();
  closeOpenDialogs();
  progressBar.close("plugin_shutdown");
}

/**
 * Remove the Banyan endpoints from Zotero's HTTP server.
 *
 * `Zotero.Server.Endpoints` is a plain registry and is not plugin-aware, so
 * without an explicit removal the classes registered here outlive the plugin
 * (disable/reload/update) and keep answering `/banyan/*` requests from a stale
 * module scope.
 */
function unregisterEndpoints(): void {
  const root = `/${ROOT_PATH}`;
  for (const path of Object.keys(Zotero.Server.Endpoints)) {
    if (path === root || path.startsWith(`${root}/`)) {
      delete Zotero.Server.Endpoints[path];
    }
  }
}

/** Close dialog windows owned by the plugin so they don't outlive it. */
function closeOpenDialogs(): void {
  for (const win of openWindowsByDocument.values()) {
    try {
      if (isWindowAlive(win)) {
        win.close();
      }
    } catch (e) {
      log.warn("closing a dialog window failed", e);
    }
  }
  openWindowsByDocument.clear();
}

/**
 * Opens the style selection dialog.
 * @param request - Style binding, stored option values and document ID
 * @returns The selected style with its stored option values, or null if cancelled
 */
export async function openStyleDialog(
  request: StyleRequestData,
): Promise<StyleResponseData | null> {
  // Throttle: if this document already has a style dialog open, activate it instead
  const windowKey = `${request.documentId}:style`;
  const existingWindow = openWindowsByDocument.get(windowKey);

  if (existingWindow && !existingWindow.closed) {
    // @ts-expect-error activate is not typed
    Zotero.Utilities.Internal.activate(existingWindow);
    return null;
  }

  // Another document (or a debug entry point) already has this dialog open.
  if (activateSingletonDialog(STYLE_DIALOG_NAME)) {
    return null;
  }

  return new Promise((resolve, reject) => {
    const io: StyleDialogIO = { data: request, resolve };
    try {
      const win = openDialogWindow(
        `chrome://${addon.data.config.addonRef}/content/styleDialog.xhtml`,
        "resizable=true",
        io,
        STYLE_DIALOG_NAME,
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
  data: CitationDialogRequestData,
): Promise<CitationResponseData | null> {
  // Throttle: if this document already has a citation dialog open, activate it instead
  const windowKey = `${data.documentId}:citation`;
  const existingWindow = openWindowsByDocument.get(windowKey);

  if (existingWindow && !existingWindow.closed) {
    // @ts-expect-error activate is not typed
    Zotero.Utilities.Internal.activate(existingWindow);
    return null;
  }

  // Another document (or a debug entry point) already has this dialog open.
  if (activateSingletonDialog(CITATION_DIALOG_NAME)) {
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
        CITATION_DIALOG_NAME,
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

  // Another document (or a debug entry point) already has this dialog open.
  if (activateSingletonDialog(BIBLIOGRAPHY_DIALOG_NAME)) {
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
        "resizable=true",
        io,
        BIBLIOGRAPHY_DIALOG_NAME,
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
