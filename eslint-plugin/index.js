'use strict';

/**
 * eslint-plugin-perfect-typescripter
 *
 * Cross-file rules that the per-file PreToolUse hook in typescript_guard.js
 * cannot see (it only gets one file at a time). Each rule reads declarations
 * from the nearest tsconfig.json project. `/setup-eslint` scaffolds the
 * parser, config and pre-commit hook.
 *
 * Rule inventory:
 *   - no-duplicate-envelope-shape: N+ type aliases / interfaces share the
 *     same field set — extract a generic.
 *   - no-shared-variant-literal-across-discriminated-unions: a string
 *     literal variant appears in N+ separate DUs — extract a shared cause.
 *   - no-variant-prefix-drift: sibling DUs disagree on the prefix of a
 *     shared suffix (PlayerLeft vs OwnerLeft).
 */

const noDuplicateEnvelopeShape = require('./rules/no-duplicate-envelope-shape.js');
const noSharedVariantLiteralAcrossDiscriminatedUnions = require('./rules/no-shared-variant-literal-across-discriminated-unions.js');
const noVariantPrefixDrift = require('./rules/no-variant-prefix-drift.js');
const { version } = require('./package.json');

module.exports = {
  meta: { name: 'perfect-typescripter', version },
  rules: {
    'no-duplicate-envelope-shape': noDuplicateEnvelopeShape,
    'no-shared-variant-literal-across-discriminated-unions': noSharedVariantLiteralAcrossDiscriminatedUnions,
    'no-variant-prefix-drift': noVariantPrefixDrift,
  },
  configs: {
    recommended: {
      plugins: ['perfect-typescripter'],
      rules: {
        'perfect-typescripter/no-duplicate-envelope-shape': 'warn',
        'perfect-typescripter/no-shared-variant-literal-across-discriminated-unions': 'warn',
        'perfect-typescripter/no-variant-prefix-drift': 'warn',
      },
    },
  },
};
