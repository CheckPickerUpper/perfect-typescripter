'use strict';

/**
 * no-shared-variant-literal-across-discriminated-unions
 *
 * Cross-file rule. For every type alias whose RHS is a string-literal
 * union (or a discriminated union with a string-literal `Kind` field),
 * collects the literal values. When the same literal (e.g. `"OwnerLeft"`)
 * appears in N+ separate DUs, fires a report on the Nth.
 *
 *   type CharacterRemoveReason = "PlayerLeft" | "OwnerDied" | ...
 *   type SummonRemoveReason    = "OwnerLeft"  | "OwnerDied" | ...
 *   type CompanionRemoveReason = "OwnerLeft"  | "OwnerDied" | ...
 *
 * → "OwnerDied" appears in 3 DUs. Extract `type OwnerExitReason =
 * "OwnerLeft" | "OwnerDied" | "OwnerDisconnected"` and reuse it in each
 * RemoveReason DU. Adding "ServerShutdown" later is one line, not 3.
 *
 * Detection looks at TWO shapes:
 *  1. Bare string-literal union: `type X = "a" | "b" | "c";`
 *  2. DU with a `Kind` discriminator: `type X = { Kind: "a"; ... } |
 *     { Kind: "b"; ... };` — the discriminator field name is configurable
 *     via options.discriminatorFieldNames.
 */

const LITERAL_REGISTRY = new Map(); // literalValue -> [{file, owner, line}]

module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Disallow the same string-literal variant appearing in N+ separate discriminated unions; extract a shared cause.',
    },
    schema: [{
      type: 'object',
      properties: {
        threshold: { type: 'integer', minimum: 2 },
        discriminatorFieldNames: { type: 'array', items: { type: 'string' } },
        ignoreLiterals: { type: 'array', items: { type: 'string' } },
      },
      additionalProperties: false,
    }],
    messages: {
      shared:
        "Variant literal {{literal}} appears in {{count}} separate discriminated unions: {{owners}}. " +
        "Extract a shared union (e.g. type SharedCause = ... | {{literal}} | ...) and reuse it in each, " +
        "so adding a new variant later is one line, not {{count}}.",
    },
  },
  create(context) {
    const opts = context.options[0] || {};
    const threshold = opts.threshold || 3;
    const discriminatorNames = new Set(opts.discriminatorFieldNames || ['kind', 'Kind', 'tag', 'Tag', 'type', 'Type']);
    const ignoreLiterals = new Set(opts.ignoreLiterals || []);

    function recordLiteral(value, owner, node) {
      if (typeof value !== 'string') return;
      if (ignoreLiterals.has(value)) return;

      if (!LITERAL_REGISTRY.has(value)) LITERAL_REGISTRY.set(value, []);
      const entries = LITERAL_REGISTRY.get(value);
      const file = context.getFilename();
      const line = node.loc ? node.loc.start.line : 0;
      const dedupeKey = `${file}:${owner}`;
      if (entries.some(e => `${e.file}:${e.owner}` === dedupeKey)) return;
      entries.push({ file, owner, line, node });

      if (entries.length >= threshold) {
        const owners = entries.map(e => `${e.owner} (${shortPath(e.file)}:${e.line})`).join(', ');
        context.report({
          node,
          messageId: 'shared',
          data: {
            literal: JSON.stringify(value),
            count: entries.length,
            owners,
          },
        });
      }
    }

    function visitUnionMembers(typeNode, ownerName, ownerNode) {
      if (!typeNode) return;
      if (typeNode.type === 'TSUnionType') {
        for (const m of typeNode.types) visitUnionMembers(m, ownerName, ownerNode);
        return;
      }
      if (typeNode.type === 'TSLiteralType' && typeNode.literal && typeof typeNode.literal.value === 'string') {
        recordLiteral(typeNode.literal.value, ownerName, ownerNode);
        return;
      }
      if (typeNode.type === 'TSTypeLiteral' && Array.isArray(typeNode.members)) {
        for (const member of typeNode.members) {
          if (member.type !== 'TSPropertySignature') continue;
          const fieldName = member.key && (member.key.name || member.key.value);
          if (!fieldName || !discriminatorNames.has(fieldName)) continue;
          const fieldType = member.typeAnnotation && member.typeAnnotation.typeAnnotation;
          if (!fieldType) continue;
          if (fieldType.type === 'TSLiteralType' && fieldType.literal && typeof fieldType.literal.value === 'string') {
            recordLiteral(fieldType.literal.value, ownerName, ownerNode);
          } else if (fieldType.type === 'TSUnionType') {
            for (const m of fieldType.types) {
              if (m.type === 'TSLiteralType' && m.literal && typeof m.literal.value === 'string') {
                recordLiteral(m.literal.value, ownerName, ownerNode);
              }
            }
          }
        }
      }
    }

    return {
      TSTypeAliasDeclaration(node) {
        visitUnionMembers(node.typeAnnotation, node.id.name, node);
      },
    };
  },
};

function shortPath(absPath) {
  if (!absPath) return '?';
  const idx = absPath.lastIndexOf('/');
  return idx === -1 ? absPath : absPath.slice(idx + 1);
}
