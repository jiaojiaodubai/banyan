/**
 * Zotero Reader preview APIs verified in `chrome/content/zotero/xpcom/reader.js`.
 */
declare namespace _ZoteroTypes {
  interface ReaderBlockingObserver {
    dispose(): void;
  }

  /**
   * Content window of an iframe hosting the reader app; it assigns
   * `window.createReader` when its bundle runs, so chrome code polls this
   * property (through `wrappedJSObject`) to detect readiness.
   */
  interface ReaderContentWindow extends Window {
    wrappedJSObject?: {
      createReader?: (...args: unknown[]) => unknown;
    };
  }

  interface ReaderPreview extends ReaderInstance {
    _blockingObserver?: ReaderBlockingObserver | null;
    /**
     * Forwarded to the internal reader through the `ReaderInstance` proxy;
     * the chrome-side class defines no sidebar method itself.
     */
    toggleSidebar(open: boolean): void;
    /**
     * Popup container the chrome-side context menus append to; `ReaderPreview`
     * has none of its own, so hosts pass one in. Typed as `Element` to accept a
     * XUL `<popupset>` or a markup-declared container.
     */
    _popupset?: Element | null;
    /** Render an app-built view context menu; optional so hosts can wrap it. */
    _openContextMenu?: (params: Reader.ContextMenuParams) => Promise<void>;
    /**
     * Previews refuse the SDT pack service; read-only hosts briefly flip this
     * flag to mint the official pack getter.
     */
    _isTransient?(): boolean;
    _createGetSDTPack?(targetWindow: Window): Reader.SdtPackGetter | null;
    /**
     * Set before `_open()`: called on user-driven sidebar changes only, so a
     * host can react without polling.
     */
    _onToggleSidebarCallback?: (open: boolean) => void;
    _onChangeSidebarWidthCallback?: (width: number) => void;
    _open(options?: {
      state?: Reader.State;
      location?: Reader.Location;
      secondViewState?: Reader.SecondViewState;
    }): Promise<boolean>;
    /**
     * Awaits the internal reader's primary view; false if it never becomes
     * ready. Hosts that call the base `_open()` use it as their readiness gate.
     */
    _waitForInternalReader(): Promise<boolean>;
  }

  interface ReaderInstancePrototype {
    _open(
      this: ReaderPreview,
      options: {
        state?: Reader.State;
        location?: Reader.Location;
        secondViewState?: Reader.SecondViewState;
        preview?: boolean;
      },
    ): Promise<boolean>;
    _openContextMenu(
      this: ReaderPreview,
      params: Reader.ContextMenuParams,
    ): Promise<void>;
  }

  interface Reader {
    openPreview(itemID: number, iframe: Element): Promise<ReaderPreview>;
  }

  namespace Reader {
    /**
     * View context menu sent from the reader app; group separators are implicit
     * between `itemGroups` entries.
     */
    interface ContextMenuItem {
      label?: string;
      disabled?: boolean;
      checked?: boolean;
      persistent?: boolean;
      groups?: ContextMenuItem[][];
      onCommand?: () => void;
    }

    interface ContextMenuParams {
      x: number;
      y: number;
      itemGroups: Array<Array<ContextMenuItem | false | null | undefined>>;
    }

    type SdtPackGetter = (options?: {
      onProgress?: (progress: number) => void;
    }) => Promise<unknown>;

    interface SdtOutlineEntry {
      title: string;
      ref?: number[];
      children?: SdtOutlineEntry[];
    }

    /** Structured-document node: text nodes carry `text`, blocks `content`. */
    interface SdtNode {
      text?: string;
      content?: SdtNode[];
    }

    /** One text node's intersection with a position. */
    interface SdtTextNodeSpan {
      block: SdtNode;
      blockRef: number[];
      node: SdtNode;
      ref: number[];
      start: number;
      end: number;
    }

    interface SdtSourcePosition {
      pageIndex: number;
      rects?: number[][];
    }

    /**
     * Two points, each a path of child indices into the structure content,
     * optionally followed by a character offset.
     */
    interface SdtPosition {
      start: number[];
      end: number[];
    }

    interface SdtPositionMapper {
      sdtToSourcePosition(pos: SdtPosition): SdtSourcePosition | null;
      textNodeSpansToSourcePosition(
        spans: SdtTextNodeSpan[],
      ): SdtSourcePosition | null;
    }

    interface SdtData {
      structure: {
        content: SdtNode[];
        catalog: { outline?: SdtOutlineEntry[] };
      };
      mapper: SdtPositionMapper;
    }

    interface PDFView {
      /**
       * Lazily fetches the embedded outline; hosts call it directly to trigger
       * the fetch without changing the visible view.
       */
      setSidebarView?(sidebarView: string): Promise<void>;
    }

    // `T` must match the zotero-types declaration to merge with it.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    interface InternalReader<T extends keyof ViewTypeMap> {
      /**
       * Zotero 10+ structured-document support; resolves to null when the pack
       * is unavailable, so feature-detect with `typeof`.
       */
      _getSDTPack?: SdtPackGetter | null;
      _loadSDT?(): Promise<SdtData | null>;
      _updateState?(state: { outline?: OutlineItem[] }): void;
    }
  }
}
