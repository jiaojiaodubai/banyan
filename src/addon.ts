import { config } from "../package.json";
import {
  ColumnOptions,
  DialogHelper,
  VirtualizedTableHelper,
} from "zotero-plugin-toolkit";
import hooks from "./hooks";
import { createZToolkit } from "./utils/ztoolkit";
import { StyleFile, Style } from "../typings/style";
import { createLocale } from "./utils/locale";
import { getStyleUI } from "./modules/styles";

class Addon {
  public data: {
    alive: boolean;
    config: typeof config;
    env: "development" | "production";
    initialized?: boolean;
    ztoolkit: ZToolkit;
    locale: Localization;
    prefs?: {
      window: Window;
      columns: Array<ColumnOptions>;
      rows: Array<{ [dataKey: string]: string }>;
      tableHelper: VirtualizedTableHelper | null;
    };
    styles: {
      files: Map<string, StyleFile>;
      cache: Map<string, Style>;
    };
    dialog?: DialogHelper;
  };
  // Lifecycle hooks
  public hooks: typeof hooks;
  // APIs
  public api: {
    getStyleUI: typeof getStyleUI;
  };

  constructor() {
    this.data = {
      alive: true,
      config,
      env: __env__,
      initialized: false,
      ztoolkit: createZToolkit(),
      locale: createLocale(),
      styles: {
        files: new Map(),
        cache: new Map(),
      },
    };
    this.hooks = hooks;
    this.api = {
      getStyleUI,
    };
  }
}

export default Addon;
