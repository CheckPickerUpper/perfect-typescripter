'use strict';

/**
 * merge-legacy-eslint-config.js
 *
 * Adds the perfect-typescripter rules to a legacy `.eslintrc.json`
 * config. JSON-format only — for `.eslintrc.js` / `.cjs` / `.yaml`,
 * we refuse to AST-rewrite and instead print a copy-pasteable block
 * for the user to add by hand. Rewriting JS/YAML safely needs a real
 * parser and we are not shipping one; better to be honest than wrong.
 */

const fs = require('fs');
const path = require('path');

const RULE_BLOCK = {
  'perfect-typescripter/no-phantom-type-param': 'error',
  'perfect-typescripter/no-duplicate-envelope-shape': 'warn',
  'perfect-typescripter/no-shared-variant-literal-across-discriminated-unions': 'warn',
  'perfect-typescripter/no-variant-prefix-drift': 'warn',
};

function mergeLegacyEslintConfig(configPath) {
  if (!configPath.endsWith('.json')) {
    return {
      action: 'manual-needed',
      reason: 'legacy non-json config',
      path: configPath,
      manualBlock: legacyManualBlockText(),
    };
  }
  const raw = fs.readFileSync(configPath, 'utf-8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      action: 'manual-needed',
      reason: `existing config did not parse as JSON: ${err.message}`,
      path: configPath,
      manualBlock: legacyManualBlockText(),
    };
  }

  parsed.parser = parsed.parser || '@typescript-eslint/parser';
  parsed.plugins = Array.isArray(parsed.plugins) ? parsed.plugins.slice() : [];
  if (!parsed.plugins.includes('perfect-typescripter')) {
    parsed.plugins.push('perfect-typescripter');
  }
  parsed.rules = parsed.rules || {};
  let added = 0;
  for (const [name, severity] of Object.entries(RULE_BLOCK)) {
    if (!(name in parsed.rules)) {
      parsed.rules[name] = severity;
      added++;
    }
  }

  fs.writeFileSync(configPath, JSON.stringify(parsed, null, 2) + '\n');
  return {
    action: added > 0 ? 'merged' : 'already-present',
    path: configPath,
    rulesAdded: added,
  };
}

function writeFreshLegacyConfig(projectRoot) {
  const target = path.join(projectRoot, '.eslintrc.json');
  if (fs.existsSync(target)) {
    return { action: 'skipped-existing', path: target };
  }
  const config = {
    parser: '@typescript-eslint/parser',
    parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    plugins: ['perfect-typescripter'],
    rules: { ...RULE_BLOCK },
  };
  fs.writeFileSync(target, JSON.stringify(config, null, 2) + '\n');
  return { action: 'wrote-fresh', path: target };
}

function legacyManualBlockText() {
  return `// Add to your existing ESLint config:
// parser: '@typescript-eslint/parser',
// plugins: [..., 'perfect-typescripter'],
// rules: {
${Object.entries(RULE_BLOCK).map(([k, v]) => `//   '${k}': '${v}',`).join('\n')}
// }`;
}

module.exports = { mergeLegacyEslintConfig, writeFreshLegacyConfig, RULE_BLOCK };
