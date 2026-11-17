const REQUIRED_EXPORTS = ["INFO", "generate"];
const REQUIRED_INFO_FIELDS = [
  "id",
  "title",
  "description",
  "citationType",
  "creator",
  "tags",
  "documentation",
  "license",
  "updated",
];
const STRING_INFO_FIELDS = ["id", "title", "description", "license", "updated"];
const ARRAY_INFO_FIELDS = ["creator", "tags", "documentation"];
const CITATION_TYPE_VALUES = new Set(["intext-citation", "note-citation"]);
const LARGE_LOOP_BOUNDARY = 100000;

function isLiteralTrue(node) {
  return node?.type === "Literal" && node.value === true;
}

function isLargeNumericLiteral(node) {
  return (
    node?.type === "Literal" &&
    typeof node.value === "number" &&
    node.value >= LARGE_LOOP_BOUNDARY
  );
}

function isLargeLoopTest(node) {
  if (!node || node.type !== "BinaryExpression") return false;
  return isLargeNumericLiteral(node.left) || isLargeNumericLiteral(node.right);
}

function getCalleeName(node) {
  if (!node) return null;
  if (node.type === "Identifier") return node.name;
  if (node.type === "MemberExpression" && !node.computed) {
    return node.property.type === "Identifier" ? node.property.name : null;
  }
  return null;
}
function isRequiredExport(name) {
  return REQUIRED_EXPORTS.includes(name);
}

function getPropertyName(node) {
  if (!node) return null;
  if (node.type === "Identifier") return node.name;
  if (node.type === "Literal") return String(node.value ?? "");
  if (
    node.type === "TemplateLiteral" &&
    node.expressions.length === 0 &&
    node.quasis.length === 1
  ) {
    return node.quasis[0]?.value?.cooked ?? "";
  }
  return null;
}

function isFunctionLike(node) {
  if (!node) return false;
  return (
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression"
  );
}

function toObjectPropertyMap(node) {
  const map = new Map();
  if (!node || node.type !== "ObjectExpression") {
    return map;
  }

  for (const property of node.properties) {
    if (property.type !== "Property" || property.kind !== "init") {
      continue;
    }
    const name = getPropertyName(property.key);
    if (name) {
      map.set(name, property.value);
    }
  }

  return map;
}

function collectStyleObjectMembers(objectExpression, styleMembers) {
  const props = toObjectPropertyMap(objectExpression);
  for (const [name, value] of props.entries()) {
    if (isRequiredExport(name)) {
      styleMembers.set(name, value);
    }
  }
}

function collectFromAssignment(assignmentExpression, bindings, styleMembers) {
  if (
    !assignmentExpression ||
    assignmentExpression.type !== "AssignmentExpression"
  ) {
    return;
  }
  if (assignmentExpression.operator !== "=") {
    return;
  }

  const { left, right } = assignmentExpression;
  if (left.type === "Identifier") {
    bindings.set(left.name, right);
    if (left.name === "style") {
      collectStyleObjectMembers(right, styleMembers);
    }
    return;
  }

  if (left.type !== "MemberExpression") {
    return;
  }
  if (left.object.type !== "Identifier" || left.object.name !== "style") {
    return;
  }

  const memberName = left.computed
    ? getPropertyName(left.property)
    : left.property.type === "Identifier"
      ? left.property.name
      : null;

  if (memberName && isRequiredExport(memberName)) {
    styleMembers.set(memberName, right);
  }
}

function collectFromVariableDeclaration(declaration, bindings, styleMembers) {
  if (!declaration || declaration.type !== "VariableDeclaration") {
    return;
  }

  for (const declarator of declaration.declarations) {
    if (declarator.id.type !== "Identifier") {
      continue;
    }

    const name = declarator.id.name;
    bindings.set(name, declarator.init || declarator.id);
    if (name === "style") {
      collectStyleObjectMembers(declarator.init, styleMembers);
    }
  }
}

function resolveBindingNode(node, bindings) {
  let current = node;
  const visited = new Set();

  while (current && current.type === "Identifier") {
    if (visited.has(current.name) || !bindings.has(current.name)) {
      break;
    }
    visited.add(current.name);
    current = bindings.get(current.name);
  }

  return current || node;
}

function getEntryNode(name, bindings, styleMembers) {
  if (bindings.has(name)) {
    return resolveBindingNode(bindings.get(name), bindings);
  }
  if (styleMembers.has(name)) {
    return resolveBindingNode(styleMembers.get(name), bindings);
  }
  return null;
}

function validateFunctionEntry(context, entryName, node) {
  if (!node) return;
  if (!isFunctionLike(node)) {
    context.report({
      node,
      messageId: "entryMustBeFunction",
      data: { name: entryName },
    });
    return;
  }
}

function validateCreatorArray(context, creatorNode) {
  if (!creatorNode || creatorNode.type !== "ArrayExpression") {
    return;
  }

  for (const element of creatorNode.elements) {
    if (!element || element.type !== "ObjectExpression") {
      continue;
    }

    const creatorProps = toObjectPropertyMap(element);
    if (!creatorProps.has("type") || !creatorProps.has("name")) {
      context.report({
        node: element,
        messageId: "creatorMissingFields",
      });
    }
  }
}

function validateInfoEntry(context, infoNode) {
  if (!infoNode) {
    return;
  }

  if (infoNode.type !== "ObjectExpression") {
    context.report({
      node: infoNode,
      messageId: "infoMustBeObject",
    });
    return;
  }

  const infoProps = toObjectPropertyMap(infoNode);
  const missingInfoFields = REQUIRED_INFO_FIELDS.filter(
    (field) => !infoProps.has(field),
  );
  if (missingInfoFields.length) {
    context.report({
      node: infoNode,
      messageId: "infoMissingFields",
      data: { missing: missingInfoFields.join(", ") },
    });
  }

  for (const field of STRING_INFO_FIELDS) {
    const valueNode = infoProps.get(field);
    if (!valueNode) continue;
    if (valueNode.type === "Literal" && typeof valueNode.value !== "string") {
      context.report({
        node: valueNode,
        messageId: "infoFieldMustBeString",
        data: { field },
      });
    }
  }

  for (const field of ARRAY_INFO_FIELDS) {
    const valueNode = infoProps.get(field);
    if (!valueNode) continue;
    if (valueNode.type !== "ArrayExpression") {
      context.report({
        node: valueNode,
        messageId: "infoFieldMustBeArray",
        data: { field },
      });
    }
  }

  const citationTypeNode = infoProps.get("citationType");
  if (citationTypeNode && citationTypeNode.type === "Literal") {
    const value = String(citationTypeNode.value ?? "");
    if (!CITATION_TYPE_VALUES.has(value)) {
      context.report({
        node: citationTypeNode,
        messageId: "infoCitationTypeInvalid",
        data: { value },
      });
    }
  }

  validateCreatorArray(context, infoProps.get("creator"));
}

const warnRiskyRuntimePatternRule = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Warn about style script patterns that can hang Banyan's sandbox runtime",
    },
    schema: [],
    messages: {
      unboundedWhile:
        "Avoid unbounded while loops in generate(); Banyan isolates permissions, not CPU time.",
      unboundedFor:
        "Avoid for(;;) loops in generate(); Banyan cannot reliably interrupt synchronous infinite loops.",
      largeSyncLoop:
        "This loop has a very large literal boundary. Prefer iterating contexts/items directly or chunking async work.",
      directRecursion:
        "Direct recursion can exhaust the style runtime. Prefer iterative helpers with explicit bounds.",
    },
  },
  create(context) {
    const functionStack = [];

    function enterFunction(node) {
      functionStack.push(node.id?.name || null);
    }

    function exitFunction() {
      functionStack.pop();
    }

    return {
      FunctionDeclaration: enterFunction,
      "FunctionDeclaration:exit": exitFunction,
      FunctionExpression: enterFunction,
      "FunctionExpression:exit": exitFunction,
      ArrowFunctionExpression() {
        functionStack.push(null);
      },
      "ArrowFunctionExpression:exit": exitFunction,
      WhileStatement(node) {
        if (isLiteralTrue(node.test)) {
          context.report({ node, messageId: "unboundedWhile" });
        }
      },
      ForStatement(node) {
        if (!node.test) {
          context.report({ node, messageId: "unboundedFor" });
          return;
        }
        if (isLargeLoopTest(node.test)) {
          context.report({ node, messageId: "largeSyncLoop" });
        }
      },
      CallExpression(node) {
        const currentFunction = functionStack[functionStack.length - 1];
        if (!currentFunction) return;
        if (getCalleeName(node.callee) === currentFunction) {
          context.report({ node, messageId: "directRecursion" });
        }
      },
    };
  },
};

const requireStyleContractRule = {
  meta: {
    type: "problem",
    docs: {
      description: "Require and validate StyleScript contract (INFO, generate)",
    },
    schema: [],
    messages: {
      missingEntries:
        "StyleScript is missing required entry points: {{missing}}. Define them as top-level bindings or as style object members.",
      entryMustBeFunction: "StyleScript entry '{{name}}' must be a function.",
      infoMustBeObject: "StyleScript entry 'INFO' must be an object literal.",
      infoMissingFields: "INFO is missing required fields: {{missing}}.",
      infoFieldMustBeString: "INFO.{{field}} should be a string literal.",
      infoFieldMustBeArray: "INFO.{{field}} should be an array.",
      infoCitationTypeInvalid:
        "INFO.citationType should be 'intext-citation' or 'note-citation', got '{{value}}'.",
      creatorMissingFields:
        "Each INFO.creator item should include both 'type' and 'name'.",
    },
  },
  create(context) {
    return {
      Program(node) {
        const bindings = new Map();
        const styleMembers = new Map();

        for (const statement of node.body) {
          if (statement.type === "VariableDeclaration") {
            collectFromVariableDeclaration(statement, bindings, styleMembers);
            continue;
          }

          if (statement.type === "FunctionDeclaration") {
            const functionName = statement.id?.name;
            if (functionName) {
              bindings.set(functionName, statement);
            }
            continue;
          }

          if (statement.type === "ExpressionStatement") {
            collectFromAssignment(statement.expression, bindings, styleMembers);
          }
        }

        const missing = REQUIRED_EXPORTS.filter(
          (name) => !getEntryNode(name, bindings, styleMembers),
        );
        if (missing.length) {
          context.report({
            node,
            messageId: "missingEntries",
            data: { missing: missing.join(", ") },
          });
        }

        const infoNode = getEntryNode("INFO", bindings, styleMembers);
        validateInfoEntry(context, infoNode);

        const generateNode = getEntryNode("generate", bindings, styleMembers);
        validateFunctionEntry(context, "generate", generateNode);
      },
    };
  },
};

/**
 * CSL name variables: a preset writes one value, so creators never land. Mirrors
 * `CSL_NAME_VARIABLES` in `src/modules/sandbox/fieldPresets.ts`; the parity test
 * keeps them in step.
 */
export const CSL_NAME_VARIABLES = new Set([
  "author",
  "chair",
  "collection-editor",
  "compiler",
  "composer",
  "container-author",
  "contributor",
  "curator",
  "director",
  "editor",
  "editorial-director",
  "executive-producer",
  "guest",
  "host",
  "illustrator",
  "interviewer",
  "narrator",
  "organizer",
  "original-author",
  "performer",
  "presenter",
  "producer",
  "recipient",
  "reviewed-author",
  "script-writer",
  "series-creator",
  "translator",
]);

/**
 * Keys a preset must never target, in normalized form. Mirrors `DENIED_KEYS` in
 * `src/modules/sandbox/fieldPresets.ts`; the parity test keeps them in step.
 */
export const PRESET_DENIED_KEYS = new Set(
  [
    "collections",
    "createdByUserID",
    "creators",
    "dateAdded",
    "dateModified",
    "deleted",
    "extra",
    "id",
    "itemType",
    "itemTypeID",
    "key",
    "lastModifiedByUserID",
    "libraryID",
    "notes",
    "parentItem",
    "relations",
    "synced",
    "tags",
    "version",
  ].map(normalizePresetKey),
);

/**
 * `extra` keys are matched case-insensitively after kebab normalization, as
 * `normalizeExtraKey()` in `src/utils/item.ts` does.
 */
function normalizePresetKey(key) {
  return String(key ?? "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)(?=[A-Z][a-z])/g, "$1-")
    .replace(/[\s_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

/**
 * Key syntax of an `extra` variable line: a letter followed by letters, digits,
 * spaces, hyphens or underscores.
 */
const EXTRA_KEY_PATTERN = /^[\p{L}][\p{L}\p{N} _-]*$/u;

function validatePresetFields(context, presetId, fieldsNode) {
  if (!fieldsNode) {
    context.report({
      node: fieldsNode ?? context.getSourceCode().ast,
      messageId: "fieldsMissing",
      data: { id: presetId },
    });
    return;
  }
  if (fieldsNode.type !== "ObjectExpression" || !fieldsNode.properties.length) {
    context.report({
      node: fieldsNode,
      messageId: "fieldsMustBeNonEmptyObject",
      data: { id: presetId },
    });
    return;
  }

  for (const property of fieldsNode.properties) {
    if (property.type !== "Property" || property.kind !== "init") {
      continue;
    }
    const key = getPropertyName(property.key);
    if (!key) continue;

    const normalized = normalizePresetKey(key);
    if (PRESET_DENIED_KEYS.has(normalized)) {
      context.report({
        node: property,
        messageId: "fieldKeyDenied",
        data: { key },
      });
      continue;
    }
    // Keys outside the variable-line syntax cannot be read back from `extra`
    // (mirrors `isValidExtraKey()` in src/utils/item.ts), so the runtime drops
    // them at apply time. Every Zotero field name satisfies the pattern.
    if (!EXTRA_KEY_PATTERN.test(key.trim())) {
      context.report({
        node: property,
        messageId: "fieldKeyInvalidSyntax",
        data: { key },
      });
      continue;
    }
    if (CSL_NAME_VARIABLES.has(normalized)) {
      context.report({
        node: property,
        messageId: "fieldKeyIsNameVariable",
        data: { key },
      });
      continue;
    }

    const value = property.value;
    if (value.type === "Literal" && value.value === null) {
      // `null` means "ask the user at apply time", which is allowed.
      continue;
    }
    if (
      value.type !== "Literal" ||
      typeof value.value !== "string" ||
      !value.value.trim()
    ) {
      context.report({
        node: value,
        messageId: "fieldValueInvalid",
        data: { key },
      });
    }
  }
}

function validateFieldPresetEntry(context, entry, seenIds) {
  if (!entry || entry.type !== "ObjectExpression") {
    context.report({ node: entry, messageId: "presetMustBeObject" });
    return;
  }

  const props = toObjectPropertyMap(entry);
  const idNode = props.get("id");
  const id =
    idNode?.type === "Literal" && typeof idNode.value === "string"
      ? idNode.value.trim()
      : "";
  if (!id) {
    context.report({
      node: idNode ?? entry,
      messageId: "presetIdInvalid",
    });
  } else if (seenIds.has(id)) {
    context.report({
      node: idNode,
      messageId: "presetIdDuplicate",
      data: { id },
    });
  } else {
    seenIds.add(id);
  }

  const labelNode = props.get("label");
  if (labelNode) {
    const isUsableLabel =
      labelNode.type === "Literal" &&
      typeof labelNode.value === "string" &&
      Boolean(labelNode.value.trim());
    if (!isUsableLabel) {
      context.report({ node: labelNode, messageId: "presetLabelInvalid" });
    }
  }

  const visibleNode = props.get("visible");
  if (visibleNode && !isFunctionLike(visibleNode)) {
    context.report({ node: visibleNode, messageId: "presetVisibleInvalid" });
  }

  validatePresetFields(context, id || "(unnamed)", props.get("fields"));
}

const validateFieldPresetsRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Validate the ITEM_FIELD_PRESETS declaration of a style (shape, writable keys)",
    },
    schema: [],
    messages: {
      presetsMustBeArray:
        "ITEM_FIELD_PRESETS should be an array of preset objects, or an object map of them.",
      presetMustBeObject:
        "Each ITEM_FIELD_PRESETS item should be an object literal.",
      presetIdInvalid:
        "Each ITEM_FIELD_PRESETS item needs a non-empty string 'id'.",
      presetIdDuplicate: "Duplicate ITEM_FIELD_PRESETS id '{{id}}'.",
      presetLabelInvalid:
        "ITEM_FIELD_PRESETS 'label' should be a non-empty plain string; styles have no locale concept, so a locale map is not supported.",
      presetVisibleInvalid:
        "ITEM_FIELD_PRESETS 'visible' should be a function returning a boolean.",
      fieldsMissing:
        "ITEM_FIELD_PRESETS item '{{id}}' needs a 'fields' object.",
      fieldsMustBeNonEmptyObject:
        "ITEM_FIELD_PRESETS item '{{id}}' 'fields' should be a non-empty object of key/value pairs.",
      fieldValueInvalid:
        "ITEM_FIELD_PRESETS '{{key}}' should be a non-empty string, or null to ask the user when the mark is applied.",
      fieldKeyDenied:
        "'{{key}}' cannot be written by a preset (it is a primary or identity field, or 'extra' itself).",
      fieldKeyIsNameVariable:
        "'{{key}}' is a CSL name variable; a preset writes a single value, so creators are not applied.",
      fieldKeyInvalidSyntax:
        "'{{key}}' is not a valid extra field key; a key starts with a letter and continues with letters, digits, spaces, hyphens or underscores.",
    },
  },
  create(context) {
    return {
      Program(node) {
        const bindings = new Map();
        const styleMembers = new Map();

        for (const statement of node.body) {
          if (statement.type === "VariableDeclaration") {
            collectFromVariableDeclaration(statement, bindings, styleMembers);
            continue;
          }
          if (statement.type === "ExpressionStatement") {
            collectFromAssignment(statement.expression, bindings, styleMembers);
          }
        }

        const presetsNode = getEntryNode(
          "ITEM_FIELD_PRESETS",
          bindings,
          styleMembers,
        );
        if (!presetsNode) {
          return;
        }

        // Both shapes the runtime accepts: an array of preset objects, or an
        // object map of them (`Object.values()`).
        let entries;
        if (presetsNode.type === "ArrayExpression") {
          entries = presetsNode.elements.filter(Boolean);
        } else if (presetsNode.type === "ObjectExpression") {
          entries = presetsNode.properties
            .filter((property) => property.type === "Property")
            .map((property) => property.value);
        } else {
          context.report({
            node: presetsNode,
            messageId: "presetsMustBeArray",
          });
          return;
        }

        const seenIds = new Set();
        for (const entry of entries) {
          validateFieldPresetEntry(context, entry, seenIds);
        }
      },
    };
  },
};

function getStyleEntryFromProgram(node, name) {
  const bindings = new Map();
  const styleMembers = new Map();
  for (const statement of node.body) {
    if (statement.type === "VariableDeclaration") {
      collectFromVariableDeclaration(statement, bindings, styleMembers);
    } else if (statement.type === "ExpressionStatement") {
      collectFromAssignment(statement.expression, bindings, styleMembers);
    }
  }
  return getEntryNode(name, bindings, styleMembers);
}

const validateItemFieldValidatorsRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Validate the ITEM_FIELD_VALIDATORS declaration of a style (item-type object, checker arrays)",
    },
    schema: [],
    messages: {
      validatorsMustBeObject:
        "ITEM_FIELD_VALIDATORS should be an object keyed by item type.",
      groupMustBeArray:
        "ITEM_FIELD_VALIDATORS['{{type}}'] should be an array of checker objects.",
      checkerMustBeObject:
        "Each ITEM_FIELD_VALIDATORS checker should be an object literal.",
      descriptionInvalid:
        "Each ITEM_FIELD_VALIDATORS checker needs a non-empty plain string 'description'.",
      descriptionDuplicate:
        "Duplicate ITEM_FIELD_VALIDATORS description '{{description}}' for '{{type}}'.",
      checkInvalid:
        "ITEM_FIELD_VALIDATORS checker '{{description}}' needs a read-only 'check' function.",
    },
  },
  create(context) {
    return {
      Program(node) {
        const validatorsNode = getStyleEntryFromProgram(
          node,
          "ITEM_FIELD_VALIDATORS",
        );
        if (!validatorsNode) {
          return;
        }
        if (validatorsNode.type !== "ObjectExpression") {
          context.report({
            node: validatorsNode,
            messageId: "validatorsMustBeObject",
          });
          return;
        }

        for (const property of validatorsNode.properties) {
          if (property.type !== "Property" || property.kind !== "init") {
            continue;
          }
          const type = getPropertyName(property.key)?.trim() ?? "";
          if (!type || property.value.type !== "ArrayExpression") {
            context.report({
              node: property,
              messageId: "groupMustBeArray",
              data: { type: type || "(unnamed)" },
            });
            continue;
          }

          const descriptions = new Set();
          for (const entry of property.value.elements.filter(Boolean)) {
            if (entry.type !== "ObjectExpression") {
              context.report({
                node: entry,
                messageId: "checkerMustBeObject",
              });
              continue;
            }

            const props = toObjectPropertyMap(entry);
            const descriptionNode = props.get("description");
            const description =
              descriptionNode?.type === "Literal" &&
              typeof descriptionNode.value === "string"
                ? descriptionNode.value.trim()
                : "";
            if (!description) {
              context.report({
                node: descriptionNode ?? entry,
                messageId: "descriptionInvalid",
              });
            } else if (descriptions.has(description)) {
              context.report({
                node: descriptionNode,
                messageId: "descriptionDuplicate",
                data: { description, type },
              });
            } else {
              descriptions.add(description);
            }

            const checkNode = props.get("check");
            if (!checkNode || !isFunctionLike(checkNode)) {
              context.report({
                node: checkNode ?? entry,
                messageId: "checkInvalid",
                data: { description: description || "(unnamed)" },
              });
            }
          }
        }
      },
    };
  },
};

export default {
  rules: {
    "require-style-contract": requireStyleContractRule,
    "warn-risky-runtime-pattern": warnRiskyRuntimePatternRule,
    "validate-field-presets": validateFieldPresetsRule,
    "validate-item-field-validators": validateItemFieldValidatorsRule,
  },
};
