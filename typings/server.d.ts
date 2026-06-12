import type {
  CitationContext,
  CitationSource,
  BibliographyLine,
  IntextCitation,
  NoteCitation,
  StyleInfo,
  StyleSummary,
  StyleUI,
} from "./style";

/**
 * Route-to-payload mapping used by the local HTTP server.
 * Keep in sync with src/modules/server.ts.
 * Must declare route's request and response types before implementing server logic.
 */
export type RouteTable = {
  hello: { req: never; res: HelloResponse };
  showInLibrary: {
    req: ShowInLibraryRequestData;
    res: ShowInLibraryResponseData;
  };
  style: { req: StyleRequestData; res: StyleResponseData };
  citation: { req: CitationRequestData; res: CitationResponseData };
  bibliography: {
    req: BibliographyRequestData;
    res: BibliographyResponseData;
  };
  refresh: {
    req: RefreshRequestData;
    res: RefreshResponseData;
  };
  convert: {
    req: ConvertRequestData;
    res: ConvertResponseData;
  };
  progress: {
    req: ProgressRequestData;
    res: ProgressResponseData;
  };
};

export type HttpPath = keyof RouteTable;
export type HelloResponse = string;

export type ShowInLibraryRequestData = {
  uri: string;
};

export type ShowInLibraryResponseData = {
  uri: string;
  shown: boolean;
};

/* style dialog */
export type StyleIdentifier = Pick<StyleInfo, "id" | "title">;
export type StyleRequestData =
  | (StyleIdentifier & { documentId: string })
  | { documentId: string };
export type StyleResponseData = StyleSummary | null;

/* Citation dialog */
export type CitationRequestData = {
  documentId: string;
  style: StyleIdentifier | StyleUI;
  source?: CitationSource;
};
export type CitationResponseData = CitationSource | null;

/* Bibliography dialog */
export type BibliographyLineAndSource = {
  line: BibliographyLine;
  extraSource?: CitationSource;
};
export type BibliographyRequestData = BibliographyLineAndSource & {
  documentId: string;
  style: StyleIdentifier;
};
export type BibliographyResponseData = BibliographyLineAndSource | null;

/* Refresh */
export type RefreshRequestData = {
  documentId: string;
  style: StyleIdentifier;
  contexts: CitationContext[];
  syncItems: boolean;
};
export type RefreshResponseData = {
  // 与 sandbox 组装后的完整 citation 输出保持一致（含 source）
  citations: IntextCitation[] | NoteCitation[];
  bibliography: BibliographyLine[];
};

/* Convert */
export type ConvertFieldInput = {
  fieldId: string;
  fieldCode: string;
};

export type ConvertRequestData = {
  documentId: string;
  citationType: "intext-citation" | "note-citation";
  fields: ConvertFieldInput[];
};

export type ConvertResponseData =
  | {
      [fieldId: string]: IntextCitation;
    }
  | {
      [fieldId: string]: NoteCitation;
    };

export type ProgressAction = "open" | "close";
export type ProgressRequestData = {
  action: ProgressAction;
  reason?: string;
};
export type ProgressResponseData = {
  action: ProgressAction;
  opened?: boolean;
  closed?: boolean;
};

export type ErrorCode =
  | "cancelled"
  | "dialog_open_failed"
  | "method_not_allowed"
  | "unsupported_media_type"
  | "invalid_params"
  | `http_${number}`
  | "internal_error";

type SuccessResponse<P extends HttpPath = HttpPath> = {
  ok: true;
  data: RouteTable[P]["res"];
};

type ErrorResponse = {
  ok: false;
  error: { code: ErrorCode; message: string };
};

export type ResponsePayload<P extends HttpPath = HttpPath> =
  | SuccessResponse<P>
  | ErrorResponse;
