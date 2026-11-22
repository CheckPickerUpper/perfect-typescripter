'use strict';

const { createProjectDeclarationListener, unwrapParenthesizedType } = require('../lib/project-type-declarations');
const { groupValuesByKey } = require('../lib/group-values-by-key');

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
    const options = context.options[0] || {};
    const threshold = options.threshold || 2;
    const minFields = options.minFields || 2;
    const ignoreNames = new Set(options.ignoreNames || []);
    return createProjectDeclarationListener({ context, inspectProject(project) {
      const printer = project.compiler.createPrinter({ removeComments: true }, {
        substituteNode(_hint, node) {
          switch (node.kind) {
            case project.compiler.SyntaxKind.StringLiteral:
              return project.compiler.factory.createStringLiteral(node.text);
            case project.compiler.SyntaxKind.ParenthesizedType:
              return unwrapParenthesizedType({ compiler: project.compiler, type: node });
            default:
              return node;
          }
        },
      });
      const envelopes = project.declarations.flatMap((declaration) => {
        if (ignoreNames.has(declaration.name)) return [];
        const fields = envelopeFields({ compiler: project.compiler, declaration, printer });
        if (fields.length < minFields) return [];
        return [{ declaration, key: fields.sort().join(' | ') }];
      });
      const groups = groupValuesByKey({ values: envelopes, key: (envelope) => envelope.key });
      for (const [fields, entries] of groups) {
        if (entries.length < threshold) continue;
        for (const entry of entries) {
          const declaration = entry.declaration;
          if (declaration.file !== project.localFile) continue;
          const others = entries.filter((partner) => partner !== entry)
            .map((partner) => `${partner.declaration.name} (${partner.declaration.relativePath}:${partner.declaration.line})`).join(', ');
          context.report({ loc: declaration.loc, messageId: 'duplicate', data: {
            name: declaration.name, fields, others, count: entries.length,
          } });
        }
      }
    } });
  },
};

function envelopeFields({ compiler, declaration, printer }) {
  let members = [];
  switch (declaration.kind) {
    case 'alias': {
      const type = unwrapParenthesizedType({ compiler, type: declaration.type });
      if (type.kind === compiler.SyntaxKind.TypeLiteral) members = type.members;
      break;
    }
    case 'interface':
      members = declaration.members;
      break;
  }
  const fields = [];
  for (const member of members) {
    if (member.kind !== compiler.SyntaxKind.PropertySignature || !member.name.text) return [];
    let typeText = 'unknown';
    if (member.type) typeText = printer.printNode(compiler.EmitHint.Unspecified, member.type, member.type.getSourceFile());
    fields.push(`${member.name.text}:${typeText}`);
  }
  return fields;
}
