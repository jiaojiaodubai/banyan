declare const _globalThis: {
  [key: string]: unknown;
  Zotero: typeof Zotero;
  ztoolkit: ZToolkit;
  addon: typeof addon;
};

declare type ZToolkit = ReturnType<
  typeof import("../src/utils/ztoolkit").createZToolkit
>;

declare const ztoolkit: ZToolkit;

declare const rootURI: string;

declare const addon: import("../src/addon").default;

declare const window: Window;

declare const document: Document;

declare const __env__: "production" | "development";
