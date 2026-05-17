'use strict';

/**
 * no-phantom-type-param
 *
 * Flags generic type parameters declared in a `<...>` list but never
 * referenced anywhere in the body of the type / interface / class /
 * function. Mirror of the PreToolUse rule in typescript_guard.js — this
 * one fires for human edits in editor / pre-commit / CI, the hook fires
 * while Claude is writing.
 *
 * Phantom params look like they constrain but don't:
 *   type WorldStateRegistry<TKind, TUpsert, TRemove> = {
 *     upsert: (p: TUpsert) => void;
 *     remove: (a: TRemove) => void;
 *   };
 * TKind is phantom — `WorldStateRegistry<"A", X, Y>` and
 * `WorldStateRegistry<"B", X, Y>` are interchangeable for any A, B.
 */

const COUNT_USED_AT_LEAST = 2; // declaration site + ≥1 usage

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow generic type parameters that are never referenced in the declaration body.',
    },
    schema: [{
      type: 'object',
      properties: {
        exemptParamNames: { type: 'array', items: { type: 'string' } },
      },
      additionalProperties: false,
    }],
    messages: {
      phantom:
        "Phantom type parameter '{{param}}' on {{kind}} '{{name}}'. " +
        "It is declared in <...> but never referenced in the body, so '{{name}}' " +
        "does not actually depend on it — callers can pass any value and the " +
        "type system won't object. Either use it (in a field type, parameter, " +
        "return type, constraint, or mapped/conditional type) or remove it.",
    },
  },
  create(context) {
    const opts = context.options[0] || {};
    const exempt = new Set(opts.exemptParamNames || []);

    function checkParams(node, kindLabel, nameNode, params) {
      if (!params || params.length === 0) return;
      if (!nameNode || !nameNode.name) return;

      const sourceCode = context.getSourceCode();
      const declText = sourceCode.getText(node);

      for (const tp of params) {
        const paramName = tp.name && tp.name.name ? tp.name.name : tp.name;
        if (typeof paramName !== 'string') continue;
        if (exempt.has(paramName)) continue;

        const wordRe = new RegExp(`\\b${escapeRegExp(paramName)}\\b`, 'g');
        const matches = declText.match(wordRe) || [];
        if (matches.length < COUNT_USED_AT_LEAST) {
          context.report({
            node: tp,
            messageId: 'phantom',
            data: {
              param: paramName,
              kind: kindLabel,
              name: nameNode.name,
            },
          });
        }
      }
    }

    return {
      TSTypeAliasDeclaration(node) {
        if (!node.typeParameters) return;
        checkParams(node, 'type', node.id, node.typeParameters.params);
      },
      TSInterfaceDeclaration(node) {
        if (!node.typeParameters) return;
        checkParams(node, 'interface', node.id, node.typeParameters.params);
      },
      ClassDeclaration(node) {
        if (!node.typeParameters) return;
        checkParams(node, 'class', node.id, node.typeParameters.params);
      },
      FunctionDeclaration(node) {
        if (!node.typeParameters) return;
        checkParams(node, 'function', node.id, node.typeParameters.params);
      },
    };
  },
};

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
