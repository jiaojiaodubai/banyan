import type {
  MultilingualCommitOutcome,
  MultilingualCommitResult,
} from "../../typings/multilingualItemDialog";

export type MultilingualCommitOps = {
  /**
   * Save the draft and link it to its group in a single transaction: the
   * source is re-read and its language re-checked inside it, so a copy is
   * never written from a stale source or next to one that appeared meanwhile.
   * Throwing means nothing was written — the transaction rolled back.
   */
  commit(): Promise<MultilingualCommitOutcome>;
  logError(error: unknown): void;
  /** Shown when the commit throws something that is not an `Error`. */
  fallbackMessage: string;
};

/**
 * Run the plugin-realm commit and turn its outcome into a plain object the
 * dialog can read across realms, where `instanceof` on a plugin class fails.
 */
export async function runMultilingualCommit(
  ops: MultilingualCommitOps,
): Promise<MultilingualCommitResult> {
  try {
    return await ops.commit();
  } catch (error) {
    ops.logError(error);
    return {
      ok: false,
      message: error instanceof Error ? error.message : ops.fallbackMessage,
    };
  }
}

/**
 * Serialize operations per key in arrival order; a plain "is one running?" flag
 * would drop the second save of the same source and language instead.
 */
export function createKeyedQueue(): <T>(
  key: string,
  run: () => Promise<T>,
) => Promise<T> {
  const tails = new Map<string, Promise<unknown>>();
  return <T>(key: string, run: () => Promise<T>): Promise<T> => {
    const previous = tails.get(key) ?? Promise.resolve();
    // Settle either way: a failed operation must not stall the ones behind it.
    const current = previous.then(run, run);
    const tail = current.catch(() => undefined);
    tails.set(key, tail);
    void tail.then(() => {
      if (tails.get(key) === tail) {
        tails.delete(key);
      }
    });
    return current;
  };
}
