'use strict';

/**
 * no-duplicate-envelope-shape
 *
 * Cross-file rule. Catalogs every type alias / interface across the
 * project and flags when N+ of them share an identical field set
 * (same field names, same field types). The fix is a generic envelope.
 *
 *   type CharacterRemoveAnnouncement = { entityID: ID; OccurredAtGameTime: T; Reason: R };
 *   type SummonRemoveAnnouncement    = { entityID: ID; OccurredAtGameTime: T; Reason: R };
 *   ...10 of these...
 *
 * → extract `type RemovalAnnouncement<TEntityID, TReason> = { entityID:
 * TEntityID; OccurredAtGameTime: GameTime; Reason: TReason };` and let
 * the 10 specific aliases be `RemovalAnnouncement<CharacterID,
 * CharacterRemoveReason>` etc.
 *
 * Module-scope catalog accumulates across every file linted in the
 * current ESLint run. The rule fires the moment the Nth duplicate lands,
 * with locations of the earlier duplicates in the message. So in CI /
 * pre-commit (full project lint) the report names every site;
 * in editor (single-file lint) the catalog rebuilds across the editor
 * session and only reports at the file currently being saved.
 */

const SHAPE_REGISTRY = new Map(); // shapeKey -> [{file, name, line}]
const MIN_FIELDS_FOR_DUPLICATE = 2;

module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow N+ type aliases / interfaces that share an identical field set; extract a generic.',
    },
    schema: [{
      type: 'object',
      properties: {
        threshold: { type: 'integer', minimum: 2 },
        minFields: { type: 'integer', minimum: 1 },
        ignoreNames: { type: 'array', items: { type: 'string' } },
      },
      additionalProperties: false,
    }],
    messages: {
      duplicate:
        "Type '{{name}}' has the same shape ({{fields}}) as {{others}}. " +
        "{{count}} declarations share this envelope — extract a generic " +
        "and parameterize the differing field types.",
    },
  },
  create(context) {
    const opts = context.options[0] || {};
    const threshold = opts.threshold || 2;
    const minFields = opts.minFields || MIN_FIELDS_FOR_DUPLICATE;
    const ignoreNames = new Set(opts.ignoreNames || []);

    function register(node, name, members) {
      if (ignoreNames.has(name)) return;
      const key = hashFieldSet(members, minFields);
      if (!key) return;

      if (!SHAPE_REGISTRY.has(key)) SHAPE_REGISTRY.set(key, []);
      const entries = SHAPE_REGISTRY.get(key);
      const file = context.getFilename();
      const line = node.loc ? node.loc.start.line : 0;

      // Avoid double-recording the same node when the same file is
      // re-linted (editor save cycles).
      const dedupeKey = `${file}:${name}:${line}`;
      if (entries.some(e => `${e.file}:${e.name}:${e.line}` === dedupeKey)) return;
      entries.push({ file, name, line, node });

      if (entries.length >= threshold) {
        const others = entries
          .filter(e => !(e.file === file && e.name === name && e.line === line))
          .map(e => `${e.name} (${shortPath(e.file)}:${e.line})`)
          .join(', ');
        context.report({
          node,
          messageId: 'duplicate',
          data: {
            name,
            fields: key,
            others: others || '(siblings)',
            count: entries.length,
          },
        });
      }
    }

    return {
      TSTypeAliasDeclaration(node) {
        if (!node.typeAnnotation || node.typeAnnotation.type !== 'TSTypeLiteral') return;
        register(node, node.id.name, node.typeAnnotation.members);
      },
      TSInterfaceDeclaration(node) {
        if (!node.body || !Array.isArray(node.body.body)) return;
        register(node, node.id.name, node.body.body);
      },
    };
  },
};

function hashFieldSet(members, minFields) {
  if (!Array.isArray(members)) return null;
  const fields = [];
  for (const m of members) {
    if (m.type !== 'TSPropertySignature') return null;
    const name = m.key && (m.key.name || m.key.value);
    if (!name) return null;
    const typeText = m.typeAnnotation
      ? serializeType(m.typeAnnotation.typeAnnotation)
      : 'unknown';
    fields.push(`${name}:${typeText}`);
  }
  if (fields.length < minFields) return null;
  fields.sort();
  return fields.join(' | ');
}

function serializeType(t) {
  if (!t) return '?';
  switch (t.type) {
    case 'TSStringKeyword': return 'string';
    case 'TSNumberKeyword': return 'number';
    case 'TSBooleanKeyword': return 'boolean';
    case 'TSAnyKeyword': return 'any';
    case 'TSUnknownKeyword': return 'unknown';
    case 'TSNullKeyword': return 'null';
    case 'TSUndefinedKeyword': return 'undefined';
    case 'TSVoidKeyword': return 'void';
    case 'TSNeverKeyword': return 'never';
    case 'TSTypeReference': {
      const head = t.typeName && (t.typeName.name || t.typeName.right?.name) || '?';
      const args = t.typeArguments?.params || t.typeParameters?.params;
      if (args && args.length > 0) {
        return `${head}<${args.map(serializeType).join(',')}>`;
      }
      return head;
    }
    case 'TSLiteralType':
      if (t.literal && 'value' in t.literal) {
        return JSON.stringify(t.literal.value);
      }
      return '?';
    case 'TSUnionType':
      return t.types.map(serializeType).join('|');
    case 'TSIntersectionType':
      return t.types.map(serializeType).join('&');
    case 'TSArrayType':
      return `${serializeType(t.elementType)}[]`;
    default:
      return t.type;
  }
}

function shortPath(absPath) {
  if (!absPath) return '?';
  const idx = absPath.lastIndexOf('/');
  return idx === -1 ? absPath : absPath.slice(idx + 1);
}
