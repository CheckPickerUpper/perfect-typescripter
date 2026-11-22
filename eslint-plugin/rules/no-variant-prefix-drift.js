'use strict';

const { createProjectDeclarationListener, collectStringVariants } = require('../lib/project-type-declarations');
const { groupValuesByKey } = require('../lib/group-values-by-key');

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
    const options = context.options[0] || {};
    const ignoreSuffixes = new Set(options.ignoreSuffixes || []);
    return createProjectDeclarationListener({ context, inspectProject(project) {
      const variants = project.declarations.flatMap((declaration) => {
        switch (declaration.kind) {
          case 'interface': return [];
          case 'alias': {
            const literals = collectStringVariants({ compiler: project.compiler, type: declaration.type, discriminatorNames: new Set() });
            return [...new Set(literals)].flatMap((value) => {
              const words = value.match(/[A-Z][a-z0-9]+/g);
              if (!words || words.length < 2) return [];
              const suffix = words[words.length - 1];
              const prefix = words.slice(0, -1).join('');
              if (ignoreSuffixes.has(suffix)) return [];
              return [{ declaration, value, prefix, suffix }];
            });
          }
        }
      });
      const groups = groupValuesByKey({ values: variants, key: (variant) => variant.suffix });
      for (const [suffix, entries] of groups) {
        for (const entry of entries) {
          if (entry.declaration.file !== project.localFile) continue;
          const partners = entries.filter((partner) => partner.declaration !== entry.declaration && partner.prefix !== entry.prefix);
          if (partners.length === 0) continue;
          const conflicts = entries.map((partner) => `${partner.value} in ${partner.declaration.name} (${partner.declaration.relativePath}:${partner.declaration.line})`).join(', ');
          context.report({ loc: entry.declaration.loc, messageId: 'drift', data: {
            value: JSON.stringify(entry.value), suffix, conflicts,
          } });
        }
      }
    } });
  },
};
