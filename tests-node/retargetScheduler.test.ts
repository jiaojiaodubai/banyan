import { assert } from "chai";
import {
  createRetargetScheduler,
  type RetargetDeps,
  type RetargetScheduler,
} from "../src/utils/retargetScheduler";

type Target = { name: string };

function setup(overrides: Partial<RetargetDeps<Target>> = {}): {
  scheduler: RetargetScheduler<Target>;
  superseded: string[];
  loaded: string[];
} {
  const superseded: string[] = [];
  const loaded: string[] = [];
  const scheduler = createRetargetScheduler<Target>({
    isBlocked: () => false,
    isAcceptable: () => true,
    isCurrent: () => false,
    hasUnsavedEdits: () => false,
    confirmDiscard: () => true,
    supersede: (target) => {
      superseded.push(target.name);
    },
    load: (target) => {
      loaded.push(target.name);
    },
    ...overrides,
  });
  return { scheduler, superseded, loaded };
}

describe("retarget scheduler", function () {
  it("refuses requests while blocked", function () {
    const { scheduler, loaded, superseded } = setup({
      isBlocked: () => true,
    });
    assert.isFalse(scheduler.request({ name: "A" }));
    assert.deepEqual(loaded, []);
    assert.deepEqual(superseded, []);
  });

  it("supersedes an unacceptable target instead of loading it", function () {
    const { scheduler, loaded, superseded } = setup({
      isAcceptable: () => false,
    });
    assert.isTrue(scheduler.request({ name: "A" }));
    assert.deepEqual(superseded, ["A"]);
    assert.deepEqual(loaded, []);
  });

  it("keeps the current session when the target is the current one", function () {
    const { scheduler, loaded, superseded } = setup({
      isCurrent: () => true,
    });
    scheduler.request({ name: "A" });
    assert.deepEqual(superseded, ["A"]);
    assert.deepEqual(loaded, []);
  });

  it("loads directly when there are no unsaved edits", function () {
    const { scheduler, loaded, superseded } = setup();
    scheduler.request({ name: "A" });
    assert.deepEqual(loaded, ["A"]);
    assert.deepEqual(superseded, []);
  });

  it("loads when the user consents to discarding edits", function () {
    const { scheduler, loaded } = setup({
      hasUnsavedEdits: () => true,
      confirmDiscard: () => true,
    });
    scheduler.request({ name: "A" });
    assert.deepEqual(loaded, ["A"]);
  });

  it("keeps the current session when the user declines to discard", function () {
    const { scheduler, loaded, superseded } = setup({
      hasUnsavedEdits: () => true,
      confirmDiscard: () => false,
    });
    scheduler.request({ name: "A" });
    assert.deepEqual(superseded, ["A"]);
    assert.deepEqual(loaded, []);
  });

  it("drops a stale request and loads the newest one after consent", function () {
    const superseded: string[] = [];
    const loaded: string[] = [];
    const scheduler = createRetargetScheduler<Target>({
      isBlocked: () => false,
      isAcceptable: () => true,
      isCurrent: () => false,
      hasUnsavedEdits: () => true,
      confirmDiscard: () => {
        scheduler.request({ name: "C" });
        return true;
      },
      supersede: (target) => {
        superseded.push(target.name);
      },
      load: (target) => {
        loaded.push(target.name);
      },
    });
    scheduler.request({ name: "B" });
    assert.deepEqual(superseded, ["B"]);
    assert.deepEqual(loaded, ["C"]);
  });

  it("drops both the stale and the newest request when the user declines", function () {
    const superseded: string[] = [];
    const loaded: string[] = [];
    const scheduler = createRetargetScheduler<Target>({
      isBlocked: () => false,
      isAcceptable: () => true,
      isCurrent: () => false,
      hasUnsavedEdits: () => true,
      confirmDiscard: () => {
        scheduler.request({ name: "C" });
        return false;
      },
      supersede: (target) => {
        superseded.push(target.name);
      },
      load: (target) => {
        loaded.push(target.name);
      },
    });
    scheduler.request({ name: "B" });
    assert.deepEqual(superseded, ["B", "C"]);
    assert.deepEqual(loaded, []);
  });

  it("prompts once and keeps only the newest of several burst requests", function () {
    const superseded: string[] = [];
    const loaded: string[] = [];
    const scheduler = createRetargetScheduler<Target>({
      isBlocked: () => false,
      isAcceptable: () => true,
      isCurrent: () => false,
      hasUnsavedEdits: () => true,
      confirmDiscard: () => {
        scheduler.request({ name: "C" });
        scheduler.request({ name: "D" });
        return true;
      },
      supersede: (target) => {
        superseded.push(target.name);
      },
      load: (target) => {
        loaded.push(target.name);
      },
    });
    scheduler.request({ name: "B" });
    assert.deepEqual(superseded, ["C", "B"]);
    assert.deepEqual(loaded, ["D"]);
  });

  it("leaves the window unchanged when the newest request is the current item", function () {
    const superseded: string[] = [];
    const loaded: string[] = [];
    const scheduler = createRetargetScheduler<Target>({
      isBlocked: () => false,
      isAcceptable: () => true,
      isCurrent: (target) => target.name === "A",
      hasUnsavedEdits: () => true,
      confirmDiscard: () => {
        scheduler.request({ name: "A" });
        return true;
      },
      supersede: (target) => {
        superseded.push(target.name);
      },
      load: (target) => {
        loaded.push(target.name);
      },
    });
    scheduler.request({ name: "B" });
    assert.deepEqual(superseded, ["B", "A"]);
    assert.deepEqual(loaded, []);
  });
});
