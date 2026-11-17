import { assert } from "chai";
import type { CiteParam, StyleOptionParam } from "@banyan/core/types/style";
import { toParamInfo, toStyleOptionParamInfos } from "../src/modules/styleList";

describe("automation parameter declarations", function () {
  it("serializes states without their runtime callbacks", function () {
    const mode: StyleOptionParam = {
      id: "mode",
      kind: "state",
      label: "Mode",
      description: "How repeated citations are abbreviated",
      states: { auto: "Auto", full: "Full" },
      defaultValue: "auto",
      forcedValue: (values) => (values.full ? "auto" : null),
    };

    assert.deepEqual(toParamInfo(mode), {
      id: "mode",
      kind: "state",
      label: "Mode",
      description: "How repeated citations are abbreviated",
      defaultValue: "auto",
      states: { auto: "Auto", full: "Full" },
      hasForcedValue: true,
    });
  });

  it("serializes values, presets, format and validator flag", function () {
    const params: StyleOptionParam[] = [
      {
        id: "maxNames",
        kind: "value",
        label: "Max names",
        defaultValue: "3",
        presets: ["1", { label: "All", value: "99" }],
        validate: () => true,
      },
      {
        id: "prefix",
        kind: "value",
        label: "Prefix",
        format: "rich",
      },
    ];

    assert.deepEqual(toStyleOptionParamInfos(params), [
      {
        id: "maxNames",
        kind: "value",
        label: "Max names",
        defaultValue: "3",
        presets: [
          { label: "1", value: "1" },
          { label: "All", value: "99" },
        ],
        hasValidate: true,
      },
      {
        id: "prefix",
        kind: "value",
        label: "Prefix",
        format: "rich",
      },
    ]);
    assert.deepEqual(toStyleOptionParamInfos(undefined), []);
  });

  it("serializes list fields and applicability flags", function () {
    const pages: CiteParam = {
      id: "pages",
      kind: "list",
      label: "Pages",
      applicable: () => true,
      min: 0,
      max: 5,
      fields: [
        { id: "start", kind: "value", label: "Start", defaultValue: "" },
        {
          id: "end",
          kind: "value",
          label: "End",
          defaultValue: "",
          validate: () => true,
        },
      ],
    };

    assert.deepEqual(toParamInfo(pages), {
      id: "pages",
      kind: "list",
      label: "Pages",
      fields: [
        {
          id: "start",
          kind: "value",
          label: "Start",
          defaultValue: "",
        },
        {
          id: "end",
          kind: "value",
          label: "End",
          defaultValue: "",
          hasValidate: true,
        },
      ],
      min: 0,
      max: 5,
      hasApplicable: true,
    });
  });
});
