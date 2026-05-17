# Perfect TypeScripter

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Tests](https://github.com/ChequePickerUpper/perfect-typescripter/actions/workflows/test.yml/badge.svg)](https://github.com/ChequePickerUpper/perfect-typescripter/actions/workflows/test.yml)

Rust-style discipline for TypeScript: bans `null`, `undefined`, optional fields, booleans-as-domain-state, `any`, `unknown`, positional args (>1), string widening, phantom type parameters, degenerate comparators, missing `@why` tags on exports, and several other shapes that compile but rot in production. Forces discriminated unions and exhaustive `switch` everywhere domain state lives.

It ships as **two artifacts** so you get both per-keystroke prevention and project-wide auditing:

| Artifact | What it does | Where it lives |
|---|---|---|
| Claude Code plugin | PreToolUse `Write`/`Edit` hooks that block the bad shapes before they land on disk. SessionStart hook that injects the rule headline into every conversation. Skills, agent, and `/setup-eslint` slash command. | this repo's root |
| `eslint-plugin-perfect-typescripter` | Four cross-file rules the per-file hook cannot see: phantom type params, duplicate envelope shapes, shared variant literals across discriminated unions, variant prefix drift. | [`./eslint-plugin/`](./eslint-plugin/) |

The Claude Code plugin catches *the file you are writing*. The ESLint plugin catches *patterns that span files*. Together they close the per-file / cross-file gap.

## What gets blocked

A taste; full catalogue in [`docs/RULES.md`](docs/RULES.md):

```ts
// blocked: optional field
type User = { name: string; email?: string };

// blocked: null / undefined in declared types
type Maybe = string | null;
function find(): User | undefined { ... }

// blocked: boolean as domain state
function setStatus(active: boolean) { ... }

// blocked: positional args (> 1)
function move(x: number, y: number, z: number) { ... }

// blocked: string widening of literal union
type Variant = "Small" | "Medium" | "Large" | string;

// blocked: phantom type parameter (TKind never used in the body)
type Registry<TKind, V> = { entries: V[] };

// blocked: degenerate comparator returning boolean over a typed input
function isSameTransition(prev: Slot, next: Slot): boolean { ... }
```

The correct shape in each case is a discriminated union with a `Kind` field and an exhaustive `switch`. See [`docs/RULES.md`](docs/RULES.md) for the rewrite of each example.

## Install

### Claude Code plugin

```bash
git clone https://github.com/ChequePickerUpper/perfect-typescripter.git ~/perfect-typescripter
claude plugin marketplace add ~/perfect-typescripter
claude plugin install perfect-typescripter@perfect-typescripter --scope user
```

Optional per-project config at `.claude/ai-lab/perfect-typescripter/config.json`:

```json
{
  "rules": {
    "positionalArgs": { "enabled": true, "threshold": 2 },
    "nullUndefined": { "enabled": true },
    "phantomTypeParams": { "exemptions": { "typeParamNames": ["TKind"] } }
  }
}
```

No config = every rule on, no exemptions. Full key reference in [`docs/RULES.md`](docs/RULES.md#configuration).

### ESLint plugin

After the first GitHub release the npm package will be installable directly:

```bash
npm install --save-dev eslint-plugin-perfect-typescripter
```

Until then, install via `file:` protocol against a clone:

```bash
npm install --save-dev file:./path/to/perfect-typescripter/eslint-plugin
```

Or wire the whole integration (parser, config, husky + lint-staged pre-commit) automatically from inside Claude Code with `/setup-eslint`; that command lives in the Claude Code plugin and detects your package manager, existing ESLint config style, and current pre-commit setup, then scaffolds what is missing.

Flat config:

```js
// eslint.config.js
import perfectTypescripter from "eslint-plugin-perfect-typescripter";

export default [
  {
    files: ["**/*.ts", "**/*.tsx"],
    plugins: { "perfect-typescripter": perfectTypescripter },
    rules: {
      "perfect-typescripter/no-phantom-type-param": "error",
      "perfect-typescripter/no-duplicate-envelope-shape": "error",
      "perfect-typescripter/no-shared-variant-literal-across-discriminated-unions": "error",
      "perfect-typescripter/no-variant-prefix-drift": "error",
    },
  },
];
```

Legacy `.eslintrc.json`:

```json
{
  "plugins": ["perfect-typescripter"],
  "rules": {
    "perfect-typescripter/no-phantom-type-param": "error",
    "perfect-typescripter/no-duplicate-envelope-shape": "error",
    "perfect-typescripter/no-shared-variant-literal-across-discriminated-unions": "error",
    "perfect-typescripter/no-variant-prefix-drift": "error"
  }
}
```

## Run the tests

```bash
npm test
```

There is no test framework dependency. The three suites are standalone Node scripts that spawn each hook as a child process and assert on stdout / stderr / exit code, so they double as integration tests for the hook IPC contract.

## Philosophy

> Make illegal states unrepresentable.

Inspired by Rust and ML-family type systems: the type signature is the documentation, the compiler proves the invariants, and the runtime never sees a `Cannot read property of undefined`. If TypeScript cannot prove a value is present, the value is wrapped in a discriminated union whose variants enumerate every reachable case. The plugin enforces this at the point of writing, not at code-review time, because by code-review time the wrong shape has already taken root in three call sites.

The per-file hooks are deliberately strict and deliberately deny rather than warn: a warning ships, a deny does not.

Further reading:

- [Making Illegal States Unrepresentable](https://ybogomolov.me/making-illegal-states-unrepresentable)
- [Rust's Type System](https://doc.rust-lang.org/book/ch06-00-enums.html)
- [Parse, Don't Validate](https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/)

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for how to add a new rule, run tests locally, and propose configuration changes.

## License

[MIT](LICENSE)
