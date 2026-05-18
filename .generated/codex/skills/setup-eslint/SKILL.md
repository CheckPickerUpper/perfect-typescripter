---
name: setup-eslint
description: "Manual escape hatch to wire eslint-plugin-perfect-typescripter into the current project. The setup-eslint-integration skill normally does this proactively without typing the command."
user-invocable: true
---

Treat the user's invocation text after `setup-eslint` as `$ARGUMENTS`.

# /setup-eslint — manual escape hatch

The proactive path is the `setup-eslint-integration` skill, which auto-fires on TS edits in projects that lack ESLint and spawns the `eslint-installer` agent. Use this slash command only when the skill heuristics did not match (you disabled it earlier in this session, or you want to force setup in a context the skill skips).

## What this command does

Spawn the `eslint-installer` subagent. The agent reads its own playbook (`agents/eslint-installer.md`), runs the orchestrator at `${CLAUDE_PLUGIN_ROOT}/lib/setup-eslint/init-eslint-orchestrator.js`, dry-runs first, applies, verifies with `npx eslint .`, and reports back with TANTO markers.

Use the Task tool to spawn:

```
Agent({
  description: "Wire ESLint into TS project",
  subagent_type: "eslint-installer",
  prompt: "User invoked /setup-eslint manually. Wire eslint-plugin-perfect-typescripter into this project. Project root is the current working directory's nearest package.json ancestor. Default: include the husky + lint-staged pre-commit hook unless the user said --no-precommit on the command line. Report back with TANTO markers."
})
```

Surface the agent's full output to the user. Do not summarize; the agent already produces a clean step-by-step.

## Why a manual entry point exists at all

The proactive skill auto-fires only when its heuristics match (TS project, no ESLint config, perfect-typescripter installed). When those heuristics skip a case the user actually wanted setup for (a non-TS project they want to ESLint anyway, a session where the skill was disabled, a setup re-run after deleting `eslint.config.js`), this command is the override.

## When NOT to use this

- Not in a Node project (no `package.json`). The agent will refuse and tell you.
- Project explicitly does not run any linter, by team policy.
- Project uses only Biome for lint and the team has agreed to that. The four cross-file rules have no Biome equivalent (Biome cannot access TypeScript AST cross-file), so wiring ESLint side-by-side adds a second linter the team did not sign up for.
