import { assert } from "chai";
import { createLogger } from "../src/utils/logger";
import type { Logger } from "../src/utils/logger";

/**
 * The logger facade over Zotero's two output channels: `debug`/`info` share
 * Zotero's debug output, `warn`/`error` also reach the error console, and every
 * line carries the module prefix it was created with.
 */
describe("logger", function () {
  const globals = globalThis as Record<string, unknown>;

  let log: Logger;
  let originalZtoolkit: unknown;
  let originalZotero: unknown;
  let debugOutput: Array<{ message: unknown; level?: number }>;
  let errorConsole: Array<{ message: unknown; type?: string }>;
  let toolkitOutput: string[];

  before(function () {
    originalZtoolkit = globals.ztoolkit;
    originalZotero = globals.Zotero;
  });

  after(function () {
    globals.ztoolkit = originalZtoolkit;
    globals.Zotero = originalZotero;
  });

  beforeEach(function () {
    log = createLogger("test-module");
    debugOutput = [];
    errorConsole = [];
    toolkitOutput = [];
    globals.ztoolkit = { log: (line: string) => toolkitOutput.push(line) };
    globals.Zotero = {
      debug: (message: unknown, level?: number) =>
        debugOutput.push({ message, level }),
      log: (message: unknown, type?: string) =>
        errorConsole.push({ message, type }),
    };
  });

  it("sends debug and info to the debug output with the module prefix", function () {
    log.debug("step", { item: 1 });
    log.info("ready");

    assert.deepEqual(toolkitOutput, [
      '[test-module] step: {"item":1}',
      "[test-module] ready",
    ]);
    assert.deepEqual(debugOutput, []);
    assert.deepEqual(errorConsole, []);
  });

  it("sends warn to the error console as a warning", function () {
    log.warn("falling back", "no file");

    assert.deepEqual(debugOutput, [
      { message: "[test-module] falling back: no file", level: 2 },
    ]);
    assert.deepEqual(errorConsole, [
      { message: "[test-module] falling back: no file", type: "warning" },
    ]);
    assert.deepEqual(toolkitOutput, []);
  });

  it("keeps an Error's stack in the debug output and names the failure", function () {
    const cause = new TypeError("bad value");
    log.error("Save failed", cause);

    assert.deepEqual(debugOutput, [{ message: cause, level: 1 }]);
    assert.deepEqual(errorConsole, [
      { message: "[test-module] Save failed: bad value", type: "error" },
    ]);
  });

  it("reports a non-Error reason on the same line", function () {
    log.error("Save failed", "disk full", { item: 7 });

    assert.deepEqual(debugOutput, [
      { message: '[test-module] Save failed: {"item":7}: disk full', level: 1 },
    ]);
    assert.deepEqual(errorConsole, [
      {
        message: '[test-module] Save failed: {"item":7}: disk full',
        type: "error",
      },
    ]);
  });

  it("serializes a detail that JSON cannot represent", function () {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    log.error("Save failed", circular);

    assert.deepEqual(errorConsole, [
      { message: "[test-module] Save failed: [object Object]", type: "error" },
    ]);
  });

  it("does not let a broken output channel fail the caller", function () {
    globals.ztoolkit = {};
    delete globals.Zotero;

    assert.doesNotThrow(() => {
      log.error("Save failed", new Error("bad value"));
      log.warn("falling back");
      log.info("done");
    });
  });
});
