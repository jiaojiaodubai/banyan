import { config } from "../package.json";
import {
  ColumnOptions,
  DialogHelper,
  VirtualizedTableHelper,
} from "zotero-plugin-toolkit";
import hooks from "./hooks";
import { createZToolkit } from "./utils/ztoolkit";
import { Style } from "@banyan/core/types/style";
import {
  IndexedFieldPreset,
  IndexedItemFieldValidators,
  StyleFile,
} from "../typings/styleIndex";
import { createLocale } from "./utils/locale";
import { getParamDeclarations } from "./modules/styles";

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
      fieldPresets: Map<string, IndexedFieldPreset[]>;
      itemFieldValidators: Map<string, IndexedItemFieldValidators>;
    };
    dialog?: DialogHelper;
  };
  // Lifecycle hooks
  public hooks: typeof hooks;
  // APIs
  public api: {
    getParamDeclarations: typeof getParamDeclarations;
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
        fieldPresets: new Map(),
        itemFieldValidators: new Map(),
      },
    };
    this.hooks = hooks;
    this.api = {
      getParamDeclarations,
    };
  }
}

export default Addon;
