'use strict';

/**
 * eslint-plugin-perfect-typescripter
 *
 * Cross-file rules that the per-file PreToolUse hook in typescript_guard.js
 * cannot see (it only gets one file at a time). Wire this in via the
 * `/setup-eslint` slash command, which scaffolds parserOptions.project +
 * config + pre-commit hook.
 *
 * Rule inventory:
 *   - no-phantom-type-param: mirror of the PreToolUse rule for human edits.
 *   - no-duplicate-envelope-shape: N+ type aliases / interfaces share the
 *     same field set — extract a generic.
 *   - no-shared-variant-literal-across-discriminated-unions: a string
 *     literal variant appears in N+ separate DUs — extract a shared cause.
 *   - no-variant-prefix-drift: sibling DUs disagree on the prefix of a
 *     shared suffix (PlayerLeft vs OwnerLeft).
 */

const noPhantomTypeParam = require('./rules/no-phantom-type-param.js');
const noDuplicateEnvelopeShape = require('./rules/no-duplicate-envelope-shape.js');
const noSharedVariantLiteralAcrossDiscriminatedUnions = require('./rules/no-shared-variant-literal-across-discriminated-unions.js');
const noVariantPrefixDrift = require('./rules/no-variant-prefix-drift.js');

module.exports = {
  rules: {
    'no-phantom-type-param': noPhantomTypeParam,
    'no-duplicate-envelope-shape': noDuplicateEnvelopeShape,
    'no-shared-variant-literal-across-discriminated-unions': noSharedVariantLiteralAcrossDiscriminatedUnions,
    'no-variant-prefix-drift': noVariantPrefixDrift,
  },
  configs: {
    recommended: {
      plugins: ['perfect-typescripter'],
      rules: {
        'perfect-typescripter/no-phantom-type-param': 'error',
        'perfect-typescripter/no-duplicate-envelope-shape': 'warn',
        'perfect-typescripter/no-shared-variant-literal-across-discriminated-unions': 'warn',
        'perfect-typescripter/no-variant-prefix-drift': 'warn',
      },
    },
  },
};
