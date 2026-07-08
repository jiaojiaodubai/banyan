const documentLocks = new Map<string, Promise<void>>();
const styleLocks = new Map<string, Promise<void>>();

function createQueuedLock(
  locks: Map<string, Promise<void>>,
  key: string,
): Promise<() => void> {
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

      return () => {
        if (released) {
          return;
        }
        released = true;
        resolveLock();

        if (locks.get(key) === currentLock) {
          locks.delete(key);
        }
      };
    });
}

/**
 * Acquires a lock for the given document, ensuring serialized access.
 * All operations on the same document are queued and executed sequentially.
 */
export function acquireDocumentLock(documentId: string): Promise<() => void> {
  return createQueuedLock(documentLocks, documentId);
}

export async function withDocumentLock<T>(
  documentId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const releaseLock = await acquireDocumentLock(documentId);

  try {
    return await operation();
  } finally {
    releaseLock();
  }
}

export function acquireStyleLock(styleId: string): Promise<() => void> {
  return createQueuedLock(styleLocks, styleId);
}
