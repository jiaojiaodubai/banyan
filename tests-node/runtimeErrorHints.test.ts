import { assert } from "chai";
import { formatRuntimeErrorDetails } from "../src/dialogs/styleEditor/runtimeErrors";

/**
 * Error formatting is a pure function, so it is testable without Zotero.
 *
 * The case that matters here is a host that does not implement a capability:
 * the message already names the capability, and the hint has to make clear that
 * the environment is at fault rather than the style — otherwise a style author
 * reads it as their own bug.
 */
describe("runtime error formatting", function () {
  const options = { errorPrefix: "Style error" };

  it("explains that a missing capability is an environment problem", function () {
    const error = new Error(
      'The host does not provide the "readFile" capability; readText is unavailable.',
    ) as Error & { code?: string };
    error.code = "host-capability";

    const formatted = formatRuntimeErrorDetails(error, options);

    assert.match(
      formatted.lines.join("\n"),
      /Hint: This is an environment problem/,
    );
  });

  it("adds no capability hint to an ordinary style error", function () {
    const error = new Error("something went wrong in generate()");

    const formatted = formatRuntimeErrorDetails(error, options);

    assert.notMatch(formatted.lines.join("\n"), /environment problem/);
  });
});
