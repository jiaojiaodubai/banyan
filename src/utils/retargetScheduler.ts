/**
 * Re-point an open dialog at a new target without DOM or Zotero. Serializes
 * only sync decisions; loading is fire-and-forget, so callers guard staleness.
 */
export type RetargetDeps<T> = {
  /** Whether requests must be refused right now (saving / editor locked). */
  isBlocked(): boolean;
  isAcceptable(target: T): boolean;
  /** Whether the target is the one already loaded (keep the current state). */
  isCurrent(target: T): boolean;
  hasUnsavedEdits(): boolean;
  /** Synchronous discard prompt; may itself trigger `request()` reentrantly. */
  confirmDiscard(): boolean;
  /** Mark a target as abandoned and settle its waiter. */
  supersede(target: T): void;
  /** Begin loading the target (must not be awaited). */
  load(target: T): void;
};

export type RetargetScheduler<T> = {
  /** Returns false when refused because the deps are blocked. */
  request(target: T): boolean;
};

export function createRetargetScheduler<T>(
  deps: RetargetDeps<T>,
): RetargetScheduler<T> {
  let pending: T | null = null;
  let deciding = false;

  /** Queue `target`; a request during the discard prompt is absorbed here. */
  function request(target: T): boolean {
    if (deps.isBlocked()) {
      return false;
    }
    if (pending !== null && pending !== target) {
      deps.supersede(pending);
    }
    pending = target;
    if (deciding) {
      return true;
    }
    deciding = true;
    try {
      let consented = false;
      while (pending !== null) {
        const next = pending;
        pending = null;
        if (!deps.isAcceptable(next) || deps.isCurrent(next)) {
          deps.supersede(next);
          continue;
        }
        if (!consented && deps.hasUnsavedEdits()) {
          const discard = deps.confirmDiscard();
          if (pending !== null) {
            // A newer request arrived while prompting; this one is stale.
            deps.supersede(next);
            if (!discard) {
              // The user kept editing, so drop the queued request too.
              deps.supersede(pending);
              pending = null;
              return true;
            }
            // Edits consented; don't re-prompt for the newer request.
            consented = true;
            continue;
          }
          if (!discard) {
            deps.supersede(next);
            return true;
          }
        }
        deps.load(next);
      }
    } finally {
      deciding = false;
    }
    return true;
  }

  return { request };
}
