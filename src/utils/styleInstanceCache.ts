/**
 * Executable style instances cached by one module copy (one window bundle).
 *
 * A style instance is tied to the window that created its sandbox, so it can
 * only run from that window. Keeping the cache module-scoped gives every
 * window its own instances: a dialog cannot hand a dead instance to the main
 * window, and closing a window discards its cache with it.
 *
 * The shared style index is the single source of truth for metadata; its
 * `epoch` changes whenever a style file is indexed or removed. A cached
 * instance is only used while the epoch it was created under is still current;
 * an older entry is dropped and rebuilt from the file on the next read.
 */
export class StyleInstanceCache<T> {
  private readonly entries = new Map<string, { instance: T; epoch: number }>();

  get(styleId: string, epoch: number): T | undefined {
    const entry = this.entries.get(styleId);
    if (!entry) {
      return undefined;
    }
    if (entry.epoch === epoch) {
      return entry.instance;
    }
    this.entries.delete(styleId);
    return undefined;
  }

  set(styleId: string, instance: T, epoch: number): void {
    this.entries.set(styleId, { instance, epoch });
  }
}
