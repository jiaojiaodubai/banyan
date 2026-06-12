import { getPref } from "./prefs";
import { isWindowAlive } from "./window";

type ProgressSetter = (percent: number | null) => void;

type IO = {
  onLoad: (callback: ProgressSetter) => void;
};

export class ProgressBar {
  private win?: Window;
  private timeoutId?: number;
  private readonly timeout: number;

  constructor(timeout?: number) {
    // / Default to user preference or 5 minutes
    this.timeout = timeout ?? getPref("progressTimeout") ?? 300000;
  }

  get isOpen(): boolean {
    return Boolean(isWindowAlive(this.win));
  }

  open(): void {
    if (this.isOpen) {
      // Replace existing progress bar
      this.close("replaced");
    }

    // Open window asynchronously to avoid blocking
    setTimeout(() => {
      const io: IO = {
        onLoad: (callback: ProgressSetter) => {
          // Pass `null` to indicate indeterminate progress
          callback(null);
        },
      };
      let options = "chrome,centerscreen,resizable=false";
      if (Zotero.isLinux) {
        options += ",dialog=no";
      }
      this.win = Services.ww.openWindow(
        // @ts-expect-error Services.ww.openWindow has incomplete type definitions
        null,
        "chrome://zotero/content/integration/progressBar.xhtml",
        "",
        options,
        io,
      ) as Window;
      // @ts-expect-error Zotero.Utilities.Internal is not typed
      Zotero.Utilities.Internal.activate(this.win);

      this.timeoutId = setTimeout(() => {
        this.close();
      }, this.timeout) as unknown as number;
    }, 0);
  }

  close(reason?: string): void {
    clearTimeout(this.timeoutId);
    if (this.isOpen && this.win) {
      this.win.close();
      ztoolkit.log(`Progress bar closed${reason ? `: ${reason}` : ""}`);
      this.win = undefined;
    } else {
      ztoolkit.log(
        `Progress bar not open${reason ? `, reason: ${reason}` : ""}`,
      );
    }
  }
}
