# Perfect TypeScripter

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Tests](https://github.com/CheckPickerUpper/perfect-typescripter/actions/workflows/test.yml/badge.svg)](https://github.com/CheckPickerUpper/perfect-typescripter/actions/workflows/test.yml)

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

This repo ships **four installable surfaces**. Pick the one that matches your agent runtime; the underlying rules and skills are the same source.

| Surface | Status | Command |
|---|---|---|
| Claude Code (plugin marketplace) | ✅ ready | `claude plugin marketplace add https://github.com/CheckPickerUpper/perfect-typescripter && claude plugin install perfect-typescripter@perfect-typescripter --scope user` |
| Codex CLI | ✅ ready | `git clone https://github.com/CheckPickerUpper/perfect-typescripter ~/.codex/plugins/cache/perfect-typescripter/perfect-typescripter/local` (Codex auto-discovers `.codex-plugin/plugin.json`) |
| OpenCode | ✅ ready | Clone, then add `"file:///.../.opencode/perfect-typescripter-opencode-bundle.js"` to `opencode.json` `plugin` array (or drop into `~/.config/opencode/plugins/`). See [OpenCode](#opencode) below. |
| Skills CLI (skills.sh / `npx skills`) | ✅ ready | `npx skills add CheckPickerUpper/perfect-typescripter` |
| npm (ESLint plugin only) | 🚧 not yet published | (planned: `npm install --save-dev eslint-plugin-perfect-typescripter` after first release) |

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

### ESLint plugin (the cross-file rules)

The cross-file rules ship as a sibling npm package, [`eslint-plugin-perfect-typescripter`](./eslint-plugin/). After the first npm release:

```bash
npm install --save-dev eslint-plugin-perfect-typescripter
```

Until then, install via `file:` protocol against a clone:

```bash
git clone https://github.com/CheckPickerUpper/perfect-typescripter.git
npm install --save-dev file:./perfect-typescripter/eslint-plugin
```

Or wire the whole integration (parser, config, husky + lint-staged pre-commit) automatically from inside Claude Code with `/setup-eslint`; that command detects your package manager, existing ESLint config style, and current pre-commit setup, then scaffolds what is missing.

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

### Codex CLI

The repo ships pre-built Codex artifacts under `.codex-plugin/plugin.json` + `.generated/codex/`. Codex auto-discovers any plugin whose source tree contains a `.codex-plugin/plugin.json` under its marketplace cache:

```bash
mkdir -p ~/.codex/plugins/cache/perfect-typescripter/perfect-typescripter
git clone https://github.com/CheckPickerUpper/perfect-typescripter \
  ~/.codex/plugins/cache/perfect-typescripter/perfect-typescripter/local
```

Restart your Codex CLI session. The PreToolUse hook fires on `Edit`, `Write`, `MultiEdit`, and `apply_patch`; the SessionStart hook injects the rule headline.

The pre-built artifacts live under `.generated/codex/`; they are checked in (un-gitignored) so installs work without a build step. Anyone changing the canonical hooks at `hooks/*.js` should rerun their preferred regeneration path (the upstream monorepo compiler today, a `tools/` script in the future); see [`CONTRIBUTING.md`](CONTRIBUTING.md).

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

**4. npm (planned).** After the first npm release the install will collapse to:

```bash
opencode plugin perfect-typescripter
```

which writes the entry into `opencode.json` and pulls from npm automatically.

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
