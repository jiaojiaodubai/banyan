import type {
  ErrorCode,
  HttpPath,
  ResponsePayload,
} from "../../../typings/server";

type GenerateResponseFn = (
  status: number,
  contentTypeOrHeaders?: string | Record<string, string>,
  body?: string,
) => string;

type BodyDataFn = () => void;

type BanyanPatchedRequestHandlerPrototype = {
  _generateResponse: GenerateResponseFn;
  _bodyData: BodyDataFn;
  __banyanOriginalGenerateResponse__?: GenerateResponseFn;
  __banyanOriginalBodyData__?: BodyDataFn;
};

type BanyanRequestHandlerThis = {
  pathname?: string;
  origin?: string;
  headers?: Record<string, string>;
  bodyLength?: number;
  _generateResponse: GenerateResponseFn;
  _requestFinished(responseBody: string, options?: unknown): void;
};

type CORSOptions = {
  rootPath: string;
  maxJsonBodyBytes: number;
  getHeader: (
    headers: Record<string, string> | undefined,
    name: string,
  ) => string;
  responseError: <P extends HttpPath>(
    code: ErrorCode,
    message: string,
  ) => ResponsePayload<P>;
};

function getCorsAllowedOrigin(
  request: BanyanRequestHandlerThis,
  getHeader: CORSOptions["getHeader"],
): string | undefined {
  return request.origin || getHeader(request.headers, "origin") || undefined;
}

function normalizeResponseHeaders(
  contentTypeOrHeaders: string | Record<string, string> | undefined,
): Record<string, string> {
  if (!contentTypeOrHeaders) {
    return {};
  }
  if (typeof contentTypeOrHeaders === "string") {
    return { "Content-Type": contentTypeOrHeaders };
  }
  return { ...contentTypeOrHeaders };
}

/**
 * Monkey-patch Zotero.Server.RequestHandler to add CORS headers for Banyan endpoints.
 */
export function enableBanyanCORS(options: CORSOptions): void {
  const { rootPath, maxJsonBodyBytes, getHeader, responseError } = options;
  // @ts-expect-error Accessing internal Zotero.Server.RequestHandler
  const RequestHandler = Zotero.Server.RequestHandler as {
    prototype: BanyanPatchedRequestHandlerPrototype;
  };
  const proto = RequestHandler.prototype;
  if (proto.__banyanOriginalGenerateResponse__) {
    return;
  }

  const originalGenerateResponse = proto._generateResponse;
  const originalBodyData = proto._bodyData;
  proto.__banyanOriginalGenerateResponse__ = originalGenerateResponse;
  proto.__banyanOriginalBodyData__ = originalBodyData;

  proto._bodyData = function (this: BanyanRequestHandlerThis) {
    if (
      this.pathname?.startsWith(`/${rootPath}/`) &&
      typeof this.bodyLength === "number" &&
      this.bodyLength > maxJsonBodyBytes
    ) {
      this._requestFinished(
        this._generateResponse(
          413,
          "application/json",
          JSON.stringify(
            responseError<HttpPath>("http_413", "Request body is too large"),
          ),
        ),
      );
      return;
    }

    return originalBodyData.call(this);
  };

  proto._generateResponse = function (
    this: BanyanRequestHandlerThis,
    status: number,
    contentTypeOrHeaders: string | Record<string, string> | undefined,
    body?: string,
  ) {
    const pathname = this.pathname || "";
    if (!pathname.startsWith(`/${rootPath}/`)) {
      return originalGenerateResponse.call(
        this,
        status,
        contentTypeOrHeaders,
        body,
      );
    }

    const headers = normalizeResponseHeaders(contentTypeOrHeaders);
    const allowedOrigin = getCorsAllowedOrigin(this, getHeader);
    if (allowedOrigin) {
      headers["Access-Control-Allow-Origin"] = allowedOrigin;
      headers.Vary = "Origin";
    }
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] =
      "Content-Type, Zotero-Allowed-Request, X-Banyan-Client";
    headers["Access-Control-Max-Age"] = "600";

    return originalGenerateResponse.call(this, status, headers, body);
  };
}

export function restoreBanyanCORS(): void {
  // @ts-expect-error Accessing internal Zotero.Server.RequestHandler
  const RequestHandler = Zotero.Server.RequestHandler as {
    prototype: BanyanPatchedRequestHandlerPrototype;
  };
  const proto = RequestHandler.prototype;
  const originalGenerateResponse = proto.__banyanOriginalGenerateResponse__;
  if (!originalGenerateResponse) {
    return;
  }

  proto._generateResponse = originalGenerateResponse;
  delete proto.__banyanOriginalGenerateResponse__;
  proto._bodyData = proto.__banyanOriginalBodyData__!;
  delete proto.__banyanOriginalBodyData__;
}
