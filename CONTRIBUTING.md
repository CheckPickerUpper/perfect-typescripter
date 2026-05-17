# Contributing to Perfect TypeScripter

Thanks for your interest. This project is small enough that the contribution loop is short: clone, write a test, write the rule, send a PR.

## Repo layout (the parts a contributor touches)

```
hooks/                     PreToolUse / SessionStart hooks. One file per concern.
  typescript_guard.js      The main detector (positional args, optionals, null, etc).
  why_tag_guard.js         Enforces @why on exported functions.
  ts-rules-inject.js       SessionStart rule headline.
  config_write_guard.js    Blocks AI from editing the project config.

lib/                       Shared helpers used by hooks. Pure functions only.
  parse-function-signature.js
  why-tag-grammar.js
  config-loader.js
  ...

skills/                    Markdown skills that Claude Code auto-loads.
agents/                    Agent definitions.
commands/                  Slash commands.
config/default.json        Built-in rule defaults; project config is merged on top.

eslint-plugin/             The npm-publishable cross-file plugin.
  rules/                   One file per rule.
  index.js                 Rule registry.

test/                      Self-contained Node scripts. No test framework.
docs/RULES.md              Full per-rule documentation.
```

## Run the tests

```bash
npm test
```

All three suites are standalone Node scripts: they spawn each hook as a child process via `child_process.spawnSync`, pipe a synthetic `tool_input` payload to stdin, then assert on stdout / stderr / exit code. No `jest`, no `vitest`, no `mocha`. That sounds austere, but the reason is structural: the hooks are themselves child processes invoked by Claude Code with a JSON IPC contract, and the test invocation mirrors that exact call shape, so the tests double as integration coverage for the IPC contract. A test framework would add a transitive dependency without making any assertion clearer; if someone proposes adding one, the burden is on showing what bug it would have caught.

## Adding a new per-file rule

A per-file rule blocks a TypeScript shape in the file being written or edited. It lives in `hooks/typescript_guard.js` (or a sibling hook if it is conceptually distinct).

1. Pick a name in `camelCase` matching the existing rule keys in `config/default.json` (e.g. `phantomTypeParams`, `nullUndefined`, `positionalArgs`).
2. Add the rule body to `hooks/typescript_guard.js`. Each rule is a function `(code, filePath, config) => violations[]` where `violations` is an array of `{ line, message }`. Keep the function pure.
3. Add a config block to `config/default.json`:
   ```json
   "yourRule": {
     "enabled": true,
     "exemptions": { "allowedFiles": [], "allowedDirectories": [] }
   }
   ```
4. Add a test in `test/` covering both the positive case (the rule fires) and at least one negative case (similar-looking code that should pass).
5. Document the rule in `docs/RULES.md` with a concrete bad / good pair.
6. Bump `version` in `plugin.toml` (minor for a new rule, patch for a bug fix on an existing rule).

## Adding a new cross-file ESLint rule

A cross-file rule sees the whole project, not one file. It lives in `eslint-plugin/rules/`.

1. Pick a kebab-case rule name (e.g. `no-shared-variant-literal-across-discriminated-unions`).
2. Implement the rule in `eslint-plugin/rules/<name>.js`. Follow ESLint's rule API.
3. Register the rule in `eslint-plugin/index.js`.
4. Bump `version` in `eslint-plugin/package.json`.
5. Document the rule in `docs/RULES.md`.
6. Add an example fixture and assertion (cross-file rules are harder to test in isolation; the recommended approach is to run ESLint against a fixture directory with two related files).

## Adding an exemption rather than a rule change

If a rule fires on code that is correct, the first instinct should be to add an exemption to the project config, not to weaken the rule. Project config lives at `.claude/ai-lab/perfect-typescripter/config.json` and merges on top of `config/default.json`. Each rule supports `exemptions.allowedFiles` and `exemptions.allowedDirectories`; some rules also support `exemptions.allowedFunctions` or `exemptions.typeParamNames`.

If you find yourself adding an exemption that feels broad enough to belong in the defaults, open an issue describing the case before sending a PR. The defaults are deliberately conservative; a built-in exemption is a long-lived commitment.

## Code style

- Pure functions in `lib/`. No I/O, no mutable module state.
- Hooks read stdin, write stdout / stderr, and exit with `0` (allow) or `2` (deny). Never throw past the `try { main() } catch` boundary.
- One file per concern. If a hook grows beyond ~200 lines, extract a `lib/` helper named for what it does.
- No top-level emoji except in user-facing rule violation messages where they aid scanning.
- Comments only when the *why* is non-obvious. Never describe what the code does.

## License

Contributions are MIT-licensed, same as the rest of the repo.
