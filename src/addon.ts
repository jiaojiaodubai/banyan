import { config } from "../package.json";
import {
  ColumnOptions,
  DialogHelper,
  VirtualizedTableHelper,
} from "zotero-plugin-toolkit";
import hooks from "./hooks";
import { createZToolkit } from "./utils/ztoolkit";
import { StyleFile } from "../typings/style";
import { createLocale } from "./utils/locale";
import { generateStyle, getStyleUI, loadStyles } from "./modules/styles";

class Addon {
  public data: {
    alive: boolean;
    config: typeof config;
    env: "development" | "production";
    initialized?: boolean;
    /** Names of the startup steps that threw; empty when startup was clean. */
    startupFailures: string[];
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
      /**
       * Incremented whenever the style index changes. Each window bundle keeps
       * its own executable instances and drops entries cached under an older
       * epoch; see `src/utils/styleInstanceCache.ts`.
       */
      epoch: number;
    };
    dialog?: DialogHelper;
  };
  // Lifecycle hooks
  public hooks: typeof hooks;
  // APIs
  public api: {
    getStyleUI: typeof getStyleUI;
    /** Render contexts with a style through the main-window bundle. */
    generate: typeof generateStyle;
    /** Rebuild the style index in the main-window bundle (reload from disk). */
    reloadStyles: typeof loadStyles;
  };

  constructor() {
    this.data = {
      alive: true,
      config,
      env: __env__,
      initialized: false,
      startupFailures: [],
      ztoolkit: createZToolkit(),
      locale: createLocale(),
      styles: {
        files: new Map(),
        epoch: 0,
      },
    };
    this.hooks = hooks;
    this.api = {
      getStyleUI,
      generate: generateStyle,
      reloadStyles: loadStyles,
    };
  }
}

export default Addon;
