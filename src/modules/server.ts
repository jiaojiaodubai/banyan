import type { IO as CitationDialogIO } from "../dialogs/citationDialog";
import type { IO as BibliographyDialogIO } from "../dialogs/bibliographyDialog";
import type { IO as StyleDialogIO } from "../dialogs/styleDialog";
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
} from "../../typings/server";
import { getStyle } from "./styles";
import { ProgressBar } from "../utils/progressBar";
import type { CitationContext, Cite } from "../../typings/style";
import { toBanyanItem } from "../utils/item";
import {
  scanInaccessibleItems,
  showInaccessibleItemsDialog,
  importInaccessibleItems,
} from "./inaccessibleItems";
import { convertCitationFields } from "./converter";
import type { CallbackStyle } from "./sandbox";

type EndpointData<P extends HttpPath> = RouteTable[P]["req"] extends never
  ? undefined
  : RouteTable[P]["req"] | undefined;

type JsonEndpointRequest<P extends HttpPath> = {
  method: "GET" | "POST";
  pathname: P;
  pathParams: Record<string, string>;
  searchParams: URLSearchParams;
  headers: Record<string, unknown>;
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
const WPS_CONFIG_KEY = "port";
const ROOT_PATH = "banyan";
const MAIN_WINDOW_READY_TIMEOUT_MS = 5000;

// Global progress bar instance for endpoints
const progressBar = new ProgressBar();

// Window throttling: track open dialog windows per document to prevent duplicates
// Key format: `${documentId}:${dialogType}` where dialogType is 'style' | 'citation' | 'bibliography'
// This allows multiple documents to have dialogs open simultaneously,
// but prevents a single document from opening duplicate dialogs
const openWindowsByDocument = new Map<string, Window>();

// Document-level mutex: ensures all operations on the same document are serialized
// Key: documentId, Value: Promise representing the currently running operation
// This prevents race conditions when multiple requests target the same document
const documentLocks = new Map<string, Promise<void>>();

type ZoteroMainWindow = Window & {
  ZoteroPane: {
    collectionsView?: unknown;
    selectItem(
      itemID: number,
      options?: { inLibraryRoot?: boolean },
    ): Promise<boolean>;
  };
};

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

function summarizeDocumentId(documentId: string): string {
  const normalized = String(documentId || "").trim();
  if (!normalized) {
    return "unknown-document";
  }

  const segments = normalized.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] || normalized;
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
    ztoolkit.logError(
      `[refresh] invalid style output after ${Date.now() - requestStartedAt}ms: ${errorMessage}`,
    );
    ztoolkit.logError(error);
    return json(400, responseError<"refresh">("invalid_params", errorMessage));
  }

  ztoolkit.logError(
    `[refresh] internal error after ${Date.now() - requestStartedAt}ms: ${summarizeUnknownError(error)}`,
  );
  ztoolkit.logError(error);
  return json(
    500,
    responseError<"refresh">(
      "internal_error",
      "Failed to refresh citations and bibliography",
    ),
  );
}

/**
 * Acquires a lock for the given document, ensuring serialized access.
 * All operations on the same document will be queued and executed sequentially.
 *
 * @param documentId - The document identifier
 * @param operation - The async operation to execute while holding the lock
 * @returns The result of the operation
 */
async function acquireDocumentLock(documentId: string): Promise<() => void> {
  // Wait for any existing operation on this document to complete
  const existingLock = documentLocks.get(documentId);
  if (existingLock) {
    await existingLock.catch(() => {
      // Ignore errors from previous operations - we still want to proceed
    });
  }

  // Create a new lock for this operation
  let resolveLock: () => void;
  const newLock = new Promise<void>((resolve) => {
    resolveLock = resolve;
  });
  documentLocks.set(documentId, newLock);
  let released = false;

  return () => {
    if (released) {
      return;
    }
    released = true;
    resolveLock!();
    if (documentLocks.get(documentId) === newLock) {
      documentLocks.delete(documentId);
    }
  };
}

async function withDocumentLock<T>(
  documentId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const releaseLock = await acquireDocumentLock(documentId);

  try {
    return await operation();
  } finally {
    releaseLock();
  }
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
      ztoolkit.logError(
        `[getItemWithMergeFallback] failed to check merged item for URI ${itemUri}`,
      );
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

    init(
      data: EndpointData<P>,
      sendResponse: (status: number, contentType: string, body: string) => void,
    ) {
      const send: JsonEndpointCallback<P> = (result) => {
        sendResponse(
          result.status,
          "application/json",
          JSON.stringify(result.body),
        );
      };

      try {
        handler({ data }, send);
      } catch (error) {
        ztoolkit.logError(error);
        send(json(500, responseError<P>("internal_error", "Internal error")));
      }
    }
  };
}

/**
 * Monkey-patch Zotero.Server.RequestHandler to add CORS headers for Banyan endpoints.
 *
 * Why this is needed:
 * - Zotero's HTTP server only adds CORS headers when the request origin matches
 *   the bookmarklet origin (see server.js _generateResponse).
 * - Browser-based clients (like the WPS plugin frontend) need CORS headers to make
 *   cross-origin requests.
 * - OPTIONS preflight requests are handled in handleRequest before reaching endpoints,
 *   so we need to patch _generateResponse to inject CORS headers for our paths.
 */
function enableCORS(): void {
  // @ts-expect-error Accessing internal Zotero.Server.RequestHandler
  const RequestHandler = Zotero.Server.RequestHandler;
  if (!RequestHandler || !RequestHandler.prototype) {
    ztoolkit.logError("Banyan: Cannot enable CORS - RequestHandler not found");
    return;
  }

  const originalGenerateResponse = RequestHandler.prototype._generateResponse;

  RequestHandler.prototype._generateResponse = function (
    this: { pathname?: string },
    status: number,
    contentTypeOrHeaders: string | Record<string, string> | undefined,
    body?: string,
  ) {
    // Only add CORS headers for Banyan routes
    const pathname = this.pathname || "";
    if (!pathname.startsWith(`/${ROOT_PATH}/`)) {
      return originalGenerateResponse.call(
        this,
        status,
        contentTypeOrHeaders,
        body,
      );
    }

    // Normalize headers to object form
    let headers: Record<string, string>;
    if (!contentTypeOrHeaders) {
      headers = {};
    } else if (typeof contentTypeOrHeaders === "string") {
      headers = { "Content-Type": contentTypeOrHeaders };
    } else {
      headers = { ...contentTypeOrHeaders };
    }

    // Inject CORS headers
    headers["Access-Control-Allow-Origin"] = "*";
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] =
      "Content-Type, X-Zotero-Connector-API-Version, Zotero-Allowed-Request";
    headers["Access-Control-Max-Age"] = "600";

    return originalGenerateResponse.call(this, status, headers, body);
  };

  ztoolkit.log(`Banyan: CORS enabled for /${ROOT_PATH}/* endpoints`);
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
    ztoolkit.logError("[refresh] invalid request payload");
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

  const finish = (result: JsonEndpointResult<"refresh">) => {
    if (settled) {
      ztoolkit.logError("[refresh] callback attempted to finish twice");
      return;
    }
    settled = true;
    try {
      releaseLock?.();
    } finally {
      send(result);
    }
  };

  const finishWithError = (error: unknown) => {
    finish(buildRefreshFailureResult(requestStartedAt, error));
  };

  ztoolkit.log(
    `[refresh] start: document=${summarizeDocumentId(documentId)}, styleId=${refreshData.style.id}`,
  );

  void (async () => {
    try {
      releaseLock = await acquireDocumentLock(documentId);

      const style = await getStyle(refreshData.style);

      const inaccessibleItems = await scanInaccessibleItems(
        refreshData.contexts,
      );

      let importedItemsMap = new Map<string, Zotero.Item>();
      if (inaccessibleItems.length > 0) {
        const userChoice = await showInaccessibleItemsDialog(inaccessibleItems);

        if (userChoice === "cancel") {
          ztoolkit.log("[refresh] cancelled by user (inaccessible items)");
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
                ztoolkit.logError(
                  `[refresh] failed to hydrate cite item: context=${context.id}, itemID=${cite.item.id}, itemURI=${cite.item.uri}`,
                );
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
          ztoolkit.log(
            `[refresh] success in ${Date.now() - requestStartedAt}ms`,
          );
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
  enableCORS();

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
        ztoolkit.log(`[showInLibrary] item not found for uri=${uri}`);
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
          `[showInLibrary] item matched uri but could not be selected: uri=${uri}, itemId=${item.id}`,
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
      ztoolkit.log(
        `[showInLibrary] selected item: uri=${uri}, itemId=${item.id}`,
      );
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
    const requestStartedAt = Date.now();

    return withDocumentLock(documentId, async () => {
      try {
        const result = await convertCitationFields(data as ConvertRequestData);
        const convertedCount = Object.keys(result).length;
        ztoolkit.log(
          `[convert] succeeded in ${Date.now() - requestStartedAt}ms (converted=${convertedCount})`,
        );
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
    await IOUtils.writeUTF8(filePath, `${WPS_CONFIG_KEY}=${port}\n`);
    ztoolkit.log(`Saved port ${port} to ${filePath}`);
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
    ztoolkit.log(
      `[openStyleDialog] Window already open for document ${documentId}, activating existing window`,
    );
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
    ztoolkit.log(
      `[openCitationDialog] Window already open for document ${data.documentId}, activating existing window`,
    );
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
    ztoolkit.log(
      `[openBibliographyDialog] Window already open for document ${data.documentId}, activating existing window`,
    );
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
