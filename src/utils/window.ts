/**
 * Check if the window is alive.
 * Useful to prevent opening duplicate windows.
 * @param win
 */
export function isWindowAlive(win?: Window) {
  return win && !Components.utils.isDeadWrapper(win) && !win.closed;
}

export function findWindowByName(name: string): Window | null {
  const enumWin = Services.wm.getEnumerator("");
  while (enumWin.hasMoreElements()) {
    const win = enumWin.getNext() as Window;
    if (!win || win.closed) continue;
    if (win.name === name || win.document?.documentElement?.id === name) {
      return win;
    }
  }
  return null;
}

/** `alwaysRaised`/`popup`, as Zotero raises its integration dialogs. */
export function getDialogRaiseFeature(): string {
  if (
    !Zotero.isMac &&
    Zotero.Prefs.get("integration.keepAddCitationDialogRaised")
  ) {
    return ",popup";
  }
  return ",alwaysRaised";
}

/** Zotero's `allOptions`: `centerscreen`, plus `dialog=no` on Linux. */
function getCommonDialogFeatures(): string {
  return Zotero.isLinux
    ? "chrome,centerscreen,dialog=no"
    : "chrome,centerscreen";
}

/** Open a dialog with no parent. Modality in `features` is inert here. */
export function openDialogWindow<T extends object>(
  url: string,
  features: string,
  io: T,
  name = "",
): Window {
  return Services.ww.openWindow(
    // @ts-expect-error Services.ww.openWindow has incomplete type definitions
    null,
    url,
    name,
    `${getCommonDialogFeatures()},${features}`,
    { wrappedJSObject: io },
  ) as Window;
}

/**
 * Read a dialog's IO out of `window.arguments[0]`. `openMainWindowDialog`
 * passes the IO itself and `openDialogWindow` wraps it, so both shapes are
 * accepted; returns null for anything else.
 */
export function unwrapDialogIO<T extends object>(value: unknown): T | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const wrapped = (value as { wrappedJSObject?: unknown }).wrappedJSObject;
  if (typeof wrapped === "object" && wrapped !== null) {
    return wrapped as T;
  }
  return value as T;
}

/**
 * Open a dialog owned by the main window, so a `modal` in `features` really
 * blocks it; falls back to `openDialogWindow` without one. Integration dialogs
 * must *not* use this: Zotero opens those parentless and always-raised, so the
 * word processor stays reachable.
 */
export function openMainWindowDialog<T extends object>(
  url: string,
  features: string,
  io: T,
  name = "",
): Window {
  const win = Zotero.getMainWindow()?.openDialog(url, name, features, io);
  return win ?? openDialogWindow(url, features, io, name);
}
