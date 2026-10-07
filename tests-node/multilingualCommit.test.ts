import { assert } from "chai";
import {
  createKeyedQueue,
  runMultilingualCommit,
  type MultilingualCommitOps,
} from "../src/utils/multilingualCommit";

const FALLBACK_MESSAGE = "save failed";

/** Let queued `then` callbacks run without depending on real timers. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function makeOps(
  overrides: Partial<MultilingualCommitOps> = {},
): MultilingualCommitOps {
  return {
    commit: async () => ({ ok: true, item: { id: 1 } as Zotero.Item }),
    logError: () => undefined,
    fallbackMessage: FALLBACK_MESSAGE,
    ...overrides,
  };
}

describe("multilingual commit orchestration", function () {
  it("passes a successful save through, notice included", async function () {
    const item = { id: 7 } as Zotero.Item;
    let logged = false;
    const outcome = await runMultilingualCommit(
      makeOps({
        commit: async () => ({ ok: true, item, notice: "1 pair skipped" }),
        logError: () => {
          logged = true;
        },
      }),
    );
    assert.deepEqual(outcome, { ok: true, item, notice: "1 pair skipped" });
    assert.isFalse(logged);
  });

  it("passes a duplicate found inside the transaction through", async function () {
    const duplicateItem = { id: 9 } as Zotero.Item;
    let logged = false;
    const outcome = await runMultilingualCommit(
      makeOps({
        commit: async () => ({ ok: false, duplicateItem }),
        logError: () => {
          logged = true;
        },
      }),
    );
    assert.deepEqual(outcome, { ok: false, duplicateItem });
    assert.isFalse(logged);
  });

  // The transaction rolls itself back, so the caller only relays the failure.
  it("reports a failed transaction with its own message", async function () {
    const failure = new Error("relation failed");
    let logged: unknown = null;
    const outcome = await runMultilingualCommit(
      makeOps({
        commit: async () => {
          throw failure;
        },
        logError: (error) => {
          logged = error;
        },
      }),
    );
    assert.deepEqual(outcome, { ok: false, message: "relation failed" });
    assert.strictEqual(logged, failure);
  });

  it("falls back to the caller's message for a non-Error throw", async function () {
    let logged: unknown = null;
    const outcome = await runMultilingualCommit(
      makeOps({
        commit: async () => {
          // Not an `Error`: a rejection relayed from another realm, say.
          throw { reason: "boom" };
        },
        logError: (error) => {
          logged = error;
        },
      }),
    );
    assert.deepEqual(outcome, { ok: false, message: FALLBACK_MESSAGE });
    assert.deepEqual(logged, { reason: "boom" });
  });

  describe("keyed commit queue", function () {
    it("runs operations on one key in order, never overlapping", async function () {
      const enqueue = createKeyedQueue();
      const order: string[] = [];
      const first = enqueue("source-a", async () => {
        order.push("first:start");
        await settle();
        order.push("first:end");
        return "first";
      });
      const second = enqueue("source-a", async () => {
        order.push("second:start");
        return "second";
      });
      assert.deepEqual(await Promise.all([first, second]), ["first", "second"]);
      assert.deepEqual(order, ["first:start", "first:end", "second:start"]);
    });

    it("keeps different keys from waiting on each other", async function () {
      const enqueue = createKeyedQueue();
      const order: string[] = [];
      const slow = enqueue("source-a", async () => {
        await settle();
        order.push("a");
      });
      const fast = enqueue("source-b", async () => {
        order.push("b");
      });
      await Promise.all([slow, fast]);
      assert.deepEqual(order, ["b", "a"]);
    });

    it("runs what follows a failed operation instead of stalling it", async function () {
      const enqueue = createKeyedQueue();
      let failed = false;
      try {
        await enqueue("source-a", async () => {
          throw new Error("boom");
        });
      } catch {
        failed = true;
      }
      assert.isTrue(failed);
      assert.equal(
        await enqueue("source-a", async () => "after failure"),
        "after failure",
      );
    });
  });
});
