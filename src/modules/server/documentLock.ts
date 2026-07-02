const documentLocks = new Map<string, Promise<void>>();
const styleLocks = new Map<string, Promise<void>>();

/**
 * Acquires a lock for the given document, ensuring serialized access.
 * All operations on the same document are queued and executed sequentially.
 */
export async function acquireDocumentLock(
  documentId: string,
): Promise<() => void> {
  const existingLock = documentLocks.get(documentId);
  if (existingLock) {
    await existingLock.catch(() => {
      // Ignore errors from previous operations; the next request may proceed.
    });
  }

  let resolveLock: () => void;
  const newLock = new Promise<void>((resolve) => {
    resolveLock = resolve;
  });
  documentLocks.set(documentId, newLock);
  let released = false;

  return () => {
    if (released) {
      return;
    }
    released = true;
    resolveLock!();
    if (documentLocks.get(documentId) === newLock) {
      documentLocks.delete(documentId);
    }
  };
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

export async function acquireStyleLock(styleId: string): Promise<() => void> {
  const existingLock = styleLocks.get(styleId);
  if (existingLock) {
    await existingLock.catch(() => {
      // Ignore errors from previous operations; the next request may proceed.
    });
  }

  let resolveLock: () => void;
  const newLock = new Promise<void>((resolve) => {
    resolveLock = resolve;
  });
  styleLocks.set(styleId, newLock);
  let released = false;

  return () => {
    if (released) {
      return;
    }
    released = true;
    resolveLock!();
    if (styleLocks.get(styleId) === newLock) {
      styleLocks.delete(styleId);
    }
  };
}
