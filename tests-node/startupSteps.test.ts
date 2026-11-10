import { assert } from "chai";
import { runStartupSteps } from "../src/utils/startup";

describe("startup step isolation", function () {
  it("keeps running the remaining steps after a failure", async function () {
    const ran: string[] = [];
    const reported: string[] = [];
    const error = new Error("boom");

    const failures = await runStartupSteps(
      [
        {
          name: "styles:load",
          run: () => {
            ran.push("styles:load");
          },
        },
        {
          name: "style-editor:runtime-assets",
          run: async () => {
            ran.push("style-editor:runtime-assets");
            throw error;
          },
        },
        {
          name: "server",
          run: () => {
            ran.push("server");
          },
        },
      ],
      (failure) => reported.push(failure.name),
    );

    assert.deepEqual(ran, [
      "styles:load",
      "style-editor:runtime-assets",
      "server",
    ]);
    assert.deepEqual(reported, ["style-editor:runtime-assets"]);
    assert.equal(failures.length, 1);
    assert.equal(failures[0].name, "style-editor:runtime-assets");
    assert.strictEqual(failures[0].error, error);
  });

  it("does not let a failing reporter stop the remaining steps", async function () {
    const ran: string[] = [];

    const failures = await runStartupSteps(
      [
        {
          name: "first",
          run: () => {
            throw new Error("first failed");
          },
        },
        {
          name: "second",
          run: () => {
            ran.push("second");
          },
        },
      ],
      () => {
        throw new Error("reporting failed");
      },
    );

    assert.deepEqual(ran, ["second"]);
    assert.equal(failures.length, 1);
    assert.equal(failures[0].name, "first");
  });

  it("returns an empty list when every step succeeds", async function () {
    const failures = await runStartupSteps(
      [
        { name: "a", run: () => undefined },
        { name: "b", run: async () => undefined },
      ],
      () => {
        throw new Error("must not be called");
      },
    );

    assert.deepEqual(failures, []);
  });
});
