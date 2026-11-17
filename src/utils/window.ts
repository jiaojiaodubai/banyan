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

/** Window names of the dialogs that are single-instance across all sources. */
export const CITATION_DIALOG_NAME = "banyan-citation-dialog";
export const STYLE_DIALOG_NAME = "banyan-style-dialog";
export const BIBLIOGRAPHY_DIALOG_NAME = "banyan-bibliography-dialog";

/**
 * Raise an already-open dialog of the given name instead of opening a second
 * one. Requests come from several front-ends (a word processor per document,
 * the debug window, the style editor), but the windows carry no visible source,
 * so two of them on screen would be indistinguishable. The dialog is a
 * singleton; a second request while it is open activates it and is answered
 * with `null`, exactly like a second request for the same document.
 */
export function activateSingletonDialog(name: string): boolean {
  const existing = findWindowByName(name);
  if (!existing || !isWindowAlive(existing)) {
    return false;
  }
  // @ts-expect-error activate is not typed
  Zotero.Utilities.Internal.activate(existing);
  return true;
}

/**
 * Topmost chrome window, typed as `Window`.
 *
 * `Services.wm.getMostRecentWindow()` is declared as a `mozIDOMWindowProxy`,
 * which has no `Window` members; chrome callers need the real window shape.
 * A dialog on top is usually the one that must own a message box: an alert
 * parented to the main window underneath an app-modal dialog is never shown.
 */
export function getTopWindow(): Window | null {
  return Services.wm.getMostRecentWindow("") as unknown as Window | null;
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

/**
 * Open a dialog with no parent. A parentless `modal` blocks the caller until
 * the window closes (and returns null in current Zotero), so dialogs that need
 * the handle are opened non-modal and raised with `activate()` instead.
 */
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
 * use `openDialogWindow` instead: Zotero opens those parentless and
 * always-raised, keeping the word processor reachable.
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
