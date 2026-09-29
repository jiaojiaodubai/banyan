import { getPref } from "../../utils/prefs";

const documentLocks = new Map<string, Promise<void>>();
const styleLocks = new Map<string, Promise<void>>();

const FALLBACK_LOCK_WATCHDOG_TIMEOUT_MS = 300000;

/**
 * Handle for a held lock.
 *
 * `release()` frees the lock for the next queued request. `forceReleased`
 * becomes `true` only when the watchdog gave up on a wedged operation and
 * released the lock on its behalf: the guarded operation must consult this
 * before writing anything back, because once it is set a *later* request may
 * already be running on the same key, and a stale write-back would race it.
 */
export type LockHandle = {
  release: () => void;
  readonly forceReleased: boolean;
};

/**
 * A lock is released only when the operation it guards settles, so an
 * operation that never settles (e.g. a user style script with an infinite loop
 * or an await that never resolves) would block its document/style queue for the
 * rest of the session and make every later request wait forever.
 *
 * Defaults to `progressTimeout` (5 minutes) so the plugin gives up at roughly
 * the same time the front-end does; `lockWatchdogTimeout` lets users tune it
 * independently.
 */
function getLockWatchdogTimeout(): number {
  const timeout = Number(getPref("lockWatchdogTimeout"));
  return Number.isFinite(timeout) && timeout > 0
    ? timeout
    : FALLBACK_LOCK_WATCHDOG_TIMEOUT_MS;
}

function createQueuedLock(
  locks: Map<string, Promise<void>>,
  key: string,
  kind: "document" | "style",
): Promise<LockHandle> {
  const previousLock = locks.get(key);

  let resolveLock!: () => void;
  const currentLock = new Promise<void>((resolve) => {
    resolveLock = resolve;
  });

  // Append this request to the tail immediately so later callers queue after it,
  // not after the previous tail.
  locks.set(key, currentLock);

  return (previousLock ?? Promise.resolve())
    .catch(() => {
      // Ignore errors from previous operations; the next request may proceed.
    })
    .then(() => {
      let released = false;
      let forceReleased = false;
      let watchdogId: ReturnType<typeof setTimeout> | null = null;

      const release = () => {
        if (released) {
          return;
        }
        released = true;
        if (watchdogId !== null) {
          clearTimeout(watchdogId);
          watchdogId = null;
        }
        resolveLock();

        if (locks.get(key) === currentLock) {
          locks.delete(key);
        }
      };

      // Force-release a wedged operation so queued requests can proceed. The
      // hung operation's own release stays a no-op, because releasing is
      // idempotent; `forceReleased` warns it not to write back once a later
      // request may have taken the lock.
      const timeout = getLockWatchdogTimeout();
      watchdogId = setTimeout(() => {
        forceReleased = true;
        ztoolkit.logError(
          `[server] ${kind} lock for "${key}" was held for ${timeout}ms; forcing release to unblock queued requests`,
        );
        release();
      }, timeout);

      return {
        release,
        get forceReleased() {
          return forceReleased;
        },
      };
    });
}

/**
 * Acquires a lock for the given document, ensuring serialized access.
 * All operations on the same document are queued and executed sequentially.
 */
export function acquireDocumentLock(documentId: string): Promise<LockHandle> {
  return createQueuedLock(documentLocks, documentId, "document");
}

export async function withDocumentLock<T>(
  documentId: string,
  operation: (lock: LockHandle) => Promise<T>,
): Promise<T> {
  const lock = await acquireDocumentLock(documentId);

  try {
    return await operation(lock);
  } finally {
    lock.release();
  }
}

export function acquireStyleLock(styleId: string): Promise<LockHandle> {
  return createQueuedLock(styleLocks, styleId, "style");
}
