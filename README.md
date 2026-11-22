# Perfect TypeScripter

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Tests](https://github.com/CheckPickerUpper/perfect-typescripter/actions/workflows/test.yml/badge.svg)](https://github.com/CheckPickerUpper/perfect-typescripter/actions/workflows/test.yml)

Rust-style discipline for TypeScript. Bans `null`, `undefined`, optional fields, booleans-as-domain-state, `any`, `unknown`, positional args (>1), string widening, phantom type parameters, degenerate comparators, missing `@why` tags on exports, and other shapes that compile but rot in production. Forces discriminated unions and exhaustive `switch` everywhere domain state lives.

## Quickstart

Pick your runtime, run the one-liner, done.

### Claude Code

```bash
claude plugin marketplace add https://github.com/CheckPickerUpper/perfect-typescripter
claude plugin install perfect-typescripter@perfect-typescripter --scope user
```

### Codex CLI

```bash
git clone https://github.com/CheckPickerUpper/perfect-typescripter \
  ~/.codex/plugins/cache/perfect-typescripter/perfect-typescripter/local
```

### OpenCode

```bash
git clone https://github.com/CheckPickerUpper/perfect-typescripter ~/perfect-typescripter
```

Then add to your `opencode.json`:

```json
{ "plugin": ["file:///home/you/perfect-typescripter/.opencode/perfect-typescripter-opencode-bundle.js"] }
```

### Skills CLI (any SKILL.md consumer: Cursor, Cline, etc.)

```bash
npx skills add CheckPickerUpper/perfect-typescripter
```

### Cross-file rules (Bun or ESLint)

From your TypeScript project's root, beside its `tsconfig.json`:

```bash
git clone https://github.com/CheckPickerUpper/perfect-typescripter.git ../perfect-typescripter
npm install --save-dev eslint@latest @typescript-eslint/parser@latest \
  file:../perfect-typescripter/eslint-plugin \
  'typescript@npm:@typescript/typescript6@latest' \
  '@typescript/cli@npm:typescript@latest'
```

The npm dependencies require Node.js `^20.19.0 || ^22.13.0 || >=24`. For TypeScript 7 projects, the aliases keep the TypeScript 6 JavaScript API available as `typescript` for the parser and cross-file rules, while `npx tsc` runs the native TypeScript 7 compiler. This follows [TypeScript's side-by-side installation approach](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-6-0).

Add the [Bun lint configuration](#bun-lint) or the [ESLint configuration](#eslint) below. In Claude Code, `/setup-eslint` can also install the dependencies, configure ESLint, and add a pre-commit hook.

For runtime options and configuration, see [Install (full)](#install-full).

## What you get

| Artifact | Catches | Where it lives |
|---|---|---|
| Claude Code / Codex / OpenCode plugin | *The file you are writing*. PreToolUse `Write` / `Edit` hooks block the bad shapes before they land on disk. | this repo's root |
| `eslint-plugin-perfect-typescripter` for Bun lint or ESLint | *Patterns that span files*: duplicate envelope shapes, shared variant literals across discriminated unions, variant prefix drift. | [`./eslint-plugin/`](./eslint-plugin/) |

The hooks check each agent edit. Bun lint or ESLint compares declarations across the TypeScript project.

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

## Install (full)

This section covers runtime configuration and the cross-file lint rules.

### Claude Code (plugin marketplace)

The repo doubles as a single-plugin marketplace via `.claude-plugin/marketplace.json` + `.claude-plugin/plugin.json`. Install in one step:

```bash
claude plugin marketplace add https://github.com/CheckPickerUpper/perfect-typescripter
claude plugin install perfect-typescripter@perfect-typescripter --scope user
```

Or from a local clone:

```bash
git clone https://github.com/CheckPickerUpper/perfect-typescripter.git ~/perfect-typescripter
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

### Skills CLI

The three skills under `skills/` (`typescript-rules`, `setup-typescripter-config`, `setup-eslint-integration`) are standards-compliant Agent Skills (lowercase-kebab name matching parent dir, required `name` + `description` in frontmatter). Install via the `skills` CLI for any agent runtime that reads SKILL.md (Cursor, Cline, codename Skills consumers, etc.):

```bash
# All three skills, project scope
npx skills add CheckPickerUpper/perfect-typescripter

# Global scope (across all projects on this user)
npx skills add -g CheckPickerUpper/perfect-typescripter

# Just one specific skill
npx skills add CheckPickerUpper/perfect-typescripter --skill typescript-rules

# List skills in the repo without installing
npx skills add CheckPickerUpper/perfect-typescripter --list
```

⚠️ The skills install activation context only; they do not install the PreToolUse hooks. If you want the *write-time blocking* behavior, use the Claude Code marketplace install above. Use the skills CLI when you want the rule documentation loaded into a non-Claude-Code agent that respects SKILL.md frontmatter.

### Cross-file rules

After the [local package install](#cross-file-rules-bun-or-eslint), choose Bun lint or ESLint. For each linted `.ts`, `.tsx`, `.mts`, or `.cts` file, the rules read declarations from the nearest `tsconfig.json` project's file list. A single-file or staged lint can therefore report matching declarations in other project files. Only linted files receive diagnostics, with partner paths relative to the project root.

The selected file uses the text supplied by the linter, including an unsaved editor buffer. Bun's `--staged` selects paths staged in Git. Other project files are read from disk. Project membership and contents are refreshed on the next lint. See [Cross-file enforcement](docs/RULES.md#cross-file-enforcement) for rule options and setup diagnostics.

#### Bun lint

With Bun 1.4.4, add to `bunfig.toml`:

```toml
[lint]
plugins = ["eslint-plugin-perfect-typescripter"]

[lint.rules]
"perfect-typescripter/no-duplicate-envelope-shape" = "error"
"perfect-typescripter/no-shared-variant-literal-across-discriminated-unions" = "error"
"perfect-typescripter/no-variant-prefix-drift" = "error"
```

Lint a file or the staged TypeScript files:

```bash
bun lint b.ts
bun lint --staged
```

#### ESLint

Create `eslint.config.mjs` with the TypeScript parser:

```js
import tsParser from "@typescript-eslint/parser";
import perfectTypescripter from "eslint-plugin-perfect-typescripter";

export default [
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    languageOptions: { parser: tsParser },
    plugins: { "perfect-typescripter": perfectTypescripter },
    rules: {
      "perfect-typescripter/no-duplicate-envelope-shape": "error",
      "perfect-typescripter/no-shared-variant-literal-across-discriminated-unions": "error",
      "perfect-typescripter/no-variant-prefix-drift": "error",
    },
  },
];
```

```bash
npx eslint b.ts
```

The plugin's `recommended` preset sets all three rules to `warn`. These examples use `error` to make findings fail the lint command. For unused type parameters, use [Bun's default TypeScript `no-unused-vars`](https://bun.com/docs/lint#default-rules), [`@typescript-eslint/no-unused-vars`](https://typescript-eslint.io/rules/no-unused-vars/), or the compiler's `noUnusedParameters`. `noUnusedLocals` checks unused local declarations.

### Codex CLI

The repo ships pre-built Codex artifacts under `.codex-plugin/plugin.json` + `.generated/codex/`. Codex auto-discovers any plugin whose source tree contains a `.codex-plugin/plugin.json` under its marketplace cache:

```bash
mkdir -p ~/.codex/plugins/cache/perfect-typescripter/perfect-typescripter
git clone https://github.com/CheckPickerUpper/perfect-typescripter \
  ~/.codex/plugins/cache/perfect-typescripter/perfect-typescripter/local
```

Restart your Codex CLI session. The PreToolUse hook fires on `Edit`, `Write`, `MultiEdit`, and `apply_patch`; the SessionStart hook injects the rule headline.

The plugin includes the generated files it needs, so installation requires no build step.

### OpenCode

The plugin ships a canonical OpenCode plugin module at `.opencode/perfect-typescripter-opencode-bundle.js` (exports `PerfectTypescripterOpencodeBundle`, returns `tool.execute.before` / `tool.execute.after` hook handlers). Three install paths per the [official OpenCode plugin docs](https://opencode.ai/docs/plugins/):

**1. Declare in `opencode.json` (recommended, no install step, version-pinnable in your repo).** From a clone:

```bash
git clone https://github.com/CheckPickerUpper/perfect-typescripter ~/perfect-typescripter
```

Then add to your project or global `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "file:///home/you/perfect-typescripter/.opencode/perfect-typescripter-opencode-bundle.js"
  ]
}
```

OpenCode auto-loads the plugin on the next session.

**2. Drop the file into `~/.config/opencode/plugins/`** (the documented global plugin dir):

```bash
git clone https://github.com/CheckPickerUpper/perfect-typescripter ~/perfect-typescripter
mkdir -p ~/.config/opencode/plugins
ln -s ~/perfect-typescripter/.opencode/perfect-typescripter-opencode-bundle.js \
      ~/.config/opencode/plugins/perfect-typescripter.js
```

`.opencode/perfect-typescripter-opencode-bundle.js` uses `fs.realpathSync` to follow the symlink back to the source tree, so the canonical `hooks/*.js` always run from your clone. `git pull` to update.

**3. Skills and agents (optional batch installer).** The bundle handles per-write blocking, but `skills/` and `agents/` need to land under `~/.config/opencode/skills/` and `~/.config/opencode/agent/` to give the agent context-on-demand. The repo ships a one-shot installer that does #2 plus skills + agents in one pass:

```bash
python3 ~/perfect-typescripter/.opencode/install.py             # symlink everything
python3 ~/perfect-typescripter/.opencode/install.py --dry-run   # preview
python3 ~/perfect-typescripter/.opencode/install.py --mode copy # copy instead of symlink (Windows)
```

## Philosophy

> Make illegal states unrepresentable.

Inspired by Rust and ML-family type systems: the type signature is the documentation, the compiler proves the invariants, and the runtime never sees a `Cannot read property of undefined`. If TypeScript cannot prove a value is present, the value is wrapped in a discriminated union whose variants enumerate every reachable case. The plugin enforces this at the point of writing, not at code-review time, because by code-review time the wrong shape has already taken root in three call sites.

The per-file hooks are deliberately strict and deliberately deny rather than warn: a warning ships, a deny does not.

Further reading:

- [Making Illegal States Unrepresentable](https://ybogomolov.me/making-illegal-states-unrepresentable)
- [Rust's Type System](https://doc.rust-lang.org/book/ch06-00-enums.html)
- [Parse, Don't Validate](https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/)

## License

[MIT](LICENSE)
