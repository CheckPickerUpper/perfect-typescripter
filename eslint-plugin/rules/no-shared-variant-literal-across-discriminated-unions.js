'use strict';

const { createProjectDeclarationListener, collectStringVariants } = require('../lib/project-type-declarations');
const { groupValuesByKey } = require('../lib/group-values-by-key');

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
    const options = context.options[0] || {};
    const threshold = options.threshold || 3;
    const discriminatorNames = new Set(options.discriminatorFieldNames || ['kind', 'Kind', 'tag', 'Tag', 'type', 'Type']);
    const ignoreLiterals = new Set(options.ignoreLiterals || []);
    return createProjectDeclarationListener({ context, inspectProject(project) {
      const variants = project.declarations.flatMap((declaration) => {
        switch (declaration.kind) {
          case 'interface': return [];
          case 'alias': {
            const literals = collectStringVariants({ compiler: project.compiler, type: declaration.type, discriminatorNames });
            return [...new Set(literals)].filter((literal) => !ignoreLiterals.has(literal))
              .map((literal) => ({ declaration, literal }));
          }
        }
      });
      const groups = groupValuesByKey({ values: variants, key: (variant) => variant.literal });
      for (const [literal, entries] of groups) {
        if (entries.length < threshold) continue;
        const owners = entries.map((entry) => `${entry.declaration.name} (${entry.declaration.relativePath}:${entry.declaration.line})`).join(', ');
        for (const entry of entries) {
          if (entry.declaration.file !== project.localFile) continue;
          context.report({ loc: entry.declaration.loc, messageId: 'shared', data: {
            literal: JSON.stringify(literal), count: entries.length, owners,
          } });
        }
      }
    } });
  },
};
