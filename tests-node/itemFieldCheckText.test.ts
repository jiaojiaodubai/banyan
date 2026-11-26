import { assert } from "chai";
import type { FieldCheckEntry } from "@banyan/core/validation/itemFieldValidators";
import {
  blockingFieldIssues,
  fieldValidationSignature,
  type FieldValidationIssue,
} from "../src/utils/itemFieldCheckText";

function check(
  status: FieldCheckEntry["status"],
  overrides: Partial<FieldCheckEntry> = {},
): FieldCheckEntry {
  return {
    id: "required-title",
    description: "Title is required",
    status,
    messages: status === "fail" ? ["Missing title"] : [],
    ...overrides,
  } as FieldCheckEntry;
}

describe("field-check editor issues", function () {
  it("drops passing checks and preserves fail/error status", function () {
    const issues = blockingFieldIssues(
      [check("pass"), check("fail"), check("error", { error: "timeout" })],
      (entry) => entry.status,
    );

    assert.deepEqual(issues, [
      {
        description: "Title is required",
        detail: "fail",
        status: "fail",
      },
      {
        description: "Title is required",
        detail: "error",
        status: "error",
      },
    ]);
  });

  it("builds the same retry signature for equivalent issues", function () {
    const issues: FieldValidationIssue[] = [
      { description: "Title", detail: "Missing", status: "fail" },
      { description: "Date", detail: "Invalid", status: "error" },
    ];

    assert.equal(
      fieldValidationSignature(issues),
      fieldValidationSignature([...issues]),
    );
    assert.notEqual(
      fieldValidationSignature(issues),
      fieldValidationSignature(issues.slice(0, 1)),
    );
  });
});
