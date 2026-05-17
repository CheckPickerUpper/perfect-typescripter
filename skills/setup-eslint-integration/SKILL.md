---
name: setup-eslint-integration
description: "Set up ESLint integration for perfect-typescripter's four cross-file rules. Use when the user says 'set up linting', 'wire up eslint', 'how do I run the cross-file rules', 'set up perfect-typescripter for this project', 'install perfect-typescripter integration', or when a TS project (tsconfig.json or .ts files) has no eslint.config.* / .eslintrc.* in the project root."
user-invocable: false
---

# Auto-setup ESLint integration for perfect-typescripter

## When this skill fires

You are looking at a TypeScript project that has perfect-typescripter installed (because this skill is shipping with that plugin) but does NOT have ESLint wired into its lint pipeline. The user's cross-file rules are therefore advisory-only via the PreToolUse hook and do NOT run on:

- Human edits the hook never sees (someone else on the team, a non-Claude session)
- Pre-commit gates
- CI gates

That means duplicate envelopes, shared variant literals, and prefix drift can land in the codebase and the user will not find out until someone manually inspects. The fix is wiring ESLint, and you should offer to do it WITHOUT making the user type a slash command.

## What you do — without asking permission for the obvious

### 1. Detect the trigger conditions

Run these checks before suggesting anything:

```bash
# Is this a TypeScript project?
ls tsconfig.json 2>/dev/null
find . -maxdepth 3 -name "*.ts" -not -path "*/node_modules/*" -not -path "*/dist/*" 2>/dev/null | head -1

# Does it already have ESLint config?
ls eslint.config.js eslint.config.mjs eslint.config.cjs eslint.config.ts \
   .eslintrc.json .eslintrc.js .eslintrc.cjs .eslintrc.yaml .eslintrc.yml 2>/dev/null

# Does package.json declare eslint or @typescript-eslint/parser?
grep -E '"(eslint|@typescript-eslint/parser|eslint-plugin-perfect-typescripter)"' package.json 2>/dev/null
```

- TS project + no ESLint config + no eslint dep → fire (Step 2).
- TS project + has eslint config but no `eslint-plugin-perfect-typescripter` in deps → fire (Step 2), the agent will detect and merge.
- Already has `eslint-plugin-perfect-typescripter` declared and the rules are in the config → skip silently. Already wired.
- Not a TS project → skip silently. Wrong context.

### 2. Tell the user what's about to happen, then spawn the agent

One short sentence explaining the gap, then spawn the `eslint-installer` agent immediately. Do NOT ask "can I set up ESLint for you?" The user already accepted the proactive contract by installing perfect-typescripter; asking again is friction.

Use this Task call shape:

```
Agent({
  description: "Wire ESLint into TS project",
  subagent_type: "eslint-installer",
  prompt: "Wire eslint-plugin-perfect-typescripter into this project. The orchestrator at ${CLAUDE_PLUGIN_ROOT}/lib/setup-eslint/init-eslint-orchestrator.js does the work. Project root is <absolute path>. The user is in <description of context, e.g. 'mid-task editing src/foo.ts'>; do NOT block their current task longer than necessary, but the wire-up is short. Default: include the husky + lint-staged pre-commit hook. Report back with TANTO markers."
})
```

The agent will dry-run first, then apply, then verify with `npx eslint .`, then report.

### 3. After the agent returns

Surface the agent's verdict to the user. Use TANTO markers. If the agent reports:

- ✅ Wired and clean → say so in one sentence and resume the user's prior task.
- ⚠️ Wired but existing violations → list them, ask whether to fix now, soften severity to `warn` while migrating, or defer.
- ❌ Setup failed → quote the failure reason, name the recovery path. Do NOT silently swallow.

## When NOT to fire this skill

- Project has Biome and explicitly no ESLint, by team policy → respect it. Tell the user once that the cross-file rules will not run, and stop. Don't keep re-suggesting on every TS edit.
- User is in the middle of a feature branch and about to commit → wiring ESLint right now adds a lockfile change to their commit, which they may not want. Ask before firing.
- Project's `package.json` is a workspace root with multiple packages, and the right place to install ESLint is per-package not at root → ask the user where to install.

## Why proactive instead of slash command

The slash command `/setup-eslint` exists as an escape hatch for users who want to invoke setup explicitly. But the failure mode of a slash command is: the user does not know it exists, they ship duplicate envelopes for six months, then learn about the command. The skill closes that gap by detecting the missing wiring on the first TS edit and offering setup before drift accumulates.

If the user objects to the proactive offer (e.g. "stop suggesting eslint, I'll set it up myself"), record the preference in conversation memory and stop firing for the rest of the session.

## Trigger fingerprint summary

| Signal | Fire? |
|--------|-------|
| User asks "how do I set up linting" / "wire up eslint" | ✅ |
| User asks why a duplicate envelope wasn't caught | ✅ |
| First TS file edit in a project with no ESLint config | ✅ once per session |
| Project already has eslint-plugin-perfect-typescripter | ❌ already wired |
| Not a TS project | ❌ wrong context |
| User said "stop suggesting eslint" earlier | ❌ respect preference |
