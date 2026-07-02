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

export default {
  rules: {
    "require-style-contract": requireStyleContractRule,
    "warn-risky-runtime-pattern": warnRiskyRuntimePatternRule,
  },
};
