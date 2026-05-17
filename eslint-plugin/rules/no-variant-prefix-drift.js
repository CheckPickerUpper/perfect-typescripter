'use strict';

/**
 * no-variant-prefix-drift
 *
 * Cross-file rule. For every string literal that participates in a
 * discriminated union, splits on the trailing word boundary into
 * (prefix, suffix) using a CapitalCase split. Suffix is the operation
 * (e.g. "Left", "Died", "Disconnected"); prefix is the actor
 * (e.g. "Player", "Owner"). When sibling DUs disagree on the prefix for
 * the same suffix — e.g. `PlayerLeft` lives in one DU and `OwnerLeft`
 * in another, both meaning "the controller of this entity left" — flag
 * the drift.
 *
 * The tool can flag drift but cannot pick the canonical winner without
 * a domain glossary. The user must decide. The report names every
 * conflicting prefix and the DU each lives in.
 *
 * False positive avoidance: only flags within the SAME suffix vocabulary.
 * `Disconnected` (network) vs `Disconnect` (action) are different
 * suffixes; we don't fuzzy-match. The split rule: the suffix is the
 * trailing CapitalWord (one or more). Everything before is the prefix.
 * `PlayerLeft` -> prefix=`Player`, suffix=`Left`. `OwnerLeft` -> prefix
 * =`Owner`, suffix=`Left`. Same suffix, different prefix, different DU
 * = drift.
 */

const SUFFIX_REGISTRY = new Map(); // suffix -> Map<prefix, [{file, owner, line, value}]>
const CAPITAL_WORD_RE = /[A-Z][a-z0-9]+/g;
const MIN_PREFIX_LEN = 1;

module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Disallow sibling discriminated unions that disagree on the prefix for the same operational suffix (PlayerLeft vs OwnerLeft).',
    },
    schema: [{
      type: 'object',
      properties: {
        ignoreSuffixes: { type: 'array', items: { type: 'string' } },
      },
      additionalProperties: false,
    }],
    messages: {
      drift:
        "Variant {{value}} (suffix '{{suffix}}') drifts: sibling DUs use different prefixes for the same operation. " +
        "Conflicting variants: {{conflicts}}. Pick one prefix as canonical (the domain glossary decides) and rename the others.",
    },
  },
  create(context) {
    const opts = context.options[0] || {};
    const ignoreSuffixes = new Set(opts.ignoreSuffixes || []);

    function recordVariant(value, ownerName, node) {
      if (typeof value !== 'string') return;
      const split = splitPrefixSuffix(value);
      if (!split) return;
      const { prefix, suffix } = split;
      if (ignoreSuffixes.has(suffix)) return;

      if (!SUFFIX_REGISTRY.has(suffix)) SUFFIX_REGISTRY.set(suffix, new Map());
      const byPrefix = SUFFIX_REGISTRY.get(suffix);

      const file = context.getFilename();
      const line = node.loc ? node.loc.start.line : 0;

      if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
      const entries = byPrefix.get(prefix);
      const dedupeKey = `${file}:${ownerName}`;
      if (!entries.some(e => `${e.file}:${e.owner}` === dedupeKey)) {
        entries.push({ file, owner: ownerName, line, value });
      }

      if (byPrefix.size >= 2) {
        const conflicts = [];
        for (const [p, es] of byPrefix) {
          for (const e of es) {
            conflicts.push(`${p}${suffix} in ${e.owner} (${shortPath(e.file)}:${e.line})`);
          }
        }
        context.report({
          node,
          messageId: 'drift',
          data: {
            value: JSON.stringify(value),
            suffix,
            conflicts: conflicts.join(', '),
          },
        });
      }
    }

    function visitTypeNode(typeNode, ownerName, ownerNode) {
      if (!typeNode) return;
      if (typeNode.type === 'TSUnionType') {
        for (const m of typeNode.types) visitTypeNode(m, ownerName, ownerNode);
        return;
      }
      if (typeNode.type === 'TSLiteralType' && typeNode.literal && typeof typeNode.literal.value === 'string') {
        recordVariant(typeNode.literal.value, ownerName, ownerNode);
      }
    }

    return {
      TSTypeAliasDeclaration(node) {
        visitTypeNode(node.typeAnnotation, node.id.name, node);
      },
    };
  },
};

function splitPrefixSuffix(value) {
  if (!value) return null;
  const words = value.match(CAPITAL_WORD_RE);
  if (!words || words.length < 2) return null;
  const suffix = words[words.length - 1];
  const prefix = words.slice(0, -1).join('');
  if (prefix.length < MIN_PREFIX_LEN) return null;
  return { prefix, suffix };
}

function shortPath(absPath) {
  if (!absPath) return '?';
  const idx = absPath.lastIndexOf('/');
  return idx === -1 ? absPath : absPath.slice(idx + 1);
}
