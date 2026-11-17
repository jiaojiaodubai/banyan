import type {
  CitationContext,
  CitationSource,
  BibliographyLine,
  IntextCitation,
  NoteCitation,
  StyleInfo,
  StyleOptionValues,
} from "./style";
import type { ParamInfo, StyleSummary } from "./styleIndex";

/**
 * Route-to-payload mapping used by the local HTTP server.
 * Keep in sync with src/modules/server/index.ts.
 * Must declare route's request and response types before implementing server logic.
 */
export type RouteTable = {
  hello: { req: never; res: HelloResponse };
  showInLibrary: {
    req: ShowInLibraryRequestData;
    res: ShowInLibraryResponseData;
  };
  style: { req: StyleRequestData; res: StyleResponseData };
  "style/list": { req: StyleListRequestData; res: StyleListResponseData };
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

/** Style plus the persisted document-wide option values. */
export type StyleBinding = StyleIdentifier & {
  options?: StyleOptionValues;
};

export type StyleRequestData = {
  documentId: string;
  /** Current style binding; absent when the document has no style yet. */
  id?: string;
  title?: string;
  /** Current style's stored values, echoed in the dialog. */
  options?: StyleOptionValues;
  /** Stored values per style, used when switching styles inside the dialog. */
  optionsByStyle?: Record<string, StyleOptionValues>;
};

export type StyleResponseData =
  | (StyleSummary & {
      /** Stored values of the confirmed style (not the effective ones). */
      options: StyleOptionValues;
    })
  | null;

export type StyleListRequestData = Record<string, never>;
export type StyleListEntry = StyleSummary & {
  /**
   * Declared style options for automation. These are the
   * declarations (labels, descriptions, kinds, defaults, states, presets and
   * lists), not a resolved value map.
   */
  optionParams: ParamInfo[];
};
export type StyleListResponseData = StyleListEntry[];

/* Citation dialog */
export type CitationRequestData = {
  documentId: string;
  /** Style binding: options travel with the style for render requests. */
  style: StyleBinding;
  source?: CitationSource;
  /**
   * Stored document-wide option values. Control predicates read the effective
   * values resolved from these, exactly like the style does during generate.
   */
  options?: StyleOptionValues;
};
export type CitationDialogRequestData = Omit<CitationRequestData, "style"> & {
  style: StyleBinding | import("./style").ParamDeclarations;
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
  style: StyleBinding;
  contexts: CitationContext[];
  /**
   * Re-resolve the contexts against the live library before the sandbox runs.
   * When enabled (the default), `citations[].source.cites[].item` in the
   * response carries the refreshed identity (`id` and the Zotero-private
   * `z:uri` extension) — merged duplicates resolve to the item that
   * replaced them — and the front-end persists it into the document so that
   * the stale identity is dropped.
   */
  syncItems: boolean;
};
export type RefreshResponseData = {
  // 与 sandbox 组装后的完整 citation 输出一致（包含 source）
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
  SuccessResponse<P> | ErrorResponse;
