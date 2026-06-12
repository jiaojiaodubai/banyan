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
