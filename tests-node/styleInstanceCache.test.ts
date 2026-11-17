import { assert } from "chai";
import { StyleInstanceCache } from "../src/utils/styleInstanceCache";

/** A stand-in for a parsed style instance; identity is all the cache cares about. */
function instance(label: string): { label: string } {
  return { label };
}

describe("style instance cache", function () {
  it("returns an instance cached under the current index epoch", function () {
    const cache = new StyleInstanceCache<{ label: string }>();
    const style = instance("style-a");

    cache.set("style-a", style, 7);

    assert.strictEqual(cache.get("style-a", 7), style);
  });

  it("drops an instance cached under an older epoch", function () {
    const cache = new StyleInstanceCache<{ label: string }>();

    cache.set("style-a", instance("style-a"), 7);

    assert.isUndefined(cache.get("style-a", 8));
    // The stale entry is gone, so a later read with the current epoch starts
    // from the file instead of resurrecting the old instance.
    assert.isUndefined(cache.get("style-a", 7));
  });

  it("returns undefined when nothing is cached for the style", function () {
    const cache = new StyleInstanceCache<{ label: string }>();

    assert.isUndefined(cache.get("unknown-style", 0));
  });

  it("replaces an instance when the same style is cached again", function () {
    const cache = new StyleInstanceCache<{ label: string }>();
    const first = instance("first");
    const second = instance("second");

    cache.set("style-a", first, 1);
    cache.set("style-a", second, 2);

    assert.strictEqual(cache.get("style-a", 2), second);
    assert.isUndefined(cache.get("style-a", 1));
  });
});
