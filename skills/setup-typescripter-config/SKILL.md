---
name: setup-typescripter-config
description: "Set up or edit .claude/ai-lab/perfect-typescripter/config.json to tune TypeScript enforcement rules. Use when the typescript guard blocks writes and the user wants to disable a rule, add exemptions, or configure the enforcer — or when the user says 'configure typescripter', 'disable boolean rule', 'add exemption', 'typescripter config'."
user-invocable: true
allowed-tools: [Read, Write, Edit, Glob, Grep, AskUserQuestion]
---

# Setup Typescripter Config

Scaffold or edit `.claude/ai-lab/perfect-typescripter/config.json` in the current project root. This config overrides the plugin's default rules — disable rules, add field/function/type exemptions, or tune enforcement per project.

## When to use

The typescript guard blocks Write/Edit when it detects banned patterns (booleans, null/undefined, optionals, enums, etc.). Some projects have legitimate reasons to relax specific rules — framework APIs that require booleans, legacy code with optionals, TSX props that need boolean fields.

## Config file location

Place `.claude/ai-lab/perfect-typescripter/config.json` at the **project root**. The hook walks up from the edited file to find it, then merges it on top of the plugin's built-in defaults.

## Schema

```json
{
  "ignorePaths": [
    { "path": "src/generated", "reason": "auto-generated types from external schema" },
    { "path": "src/vendor", "reason": "third-party code, not under our control" }
  ],
  "rules": {
    "booleanFields":      { "enabled": true, "exemptions": { "fieldNames": [], "typeNames": [], "tsxFiles": true } },
    "booleanParams":      { "enabled": true, "exemptions": { "privateFunctions": true } },
    "booleanReturns":     { "enabled": true },
    "nullUndefined":      { "enabled": true, "exemptions": { "functionNames": [], "commentTag": "@api-boundary" } },
    "optionalProperties": { "enabled": true, "exemptions": { "commentTag": "@api-boundary" } },
    "optionalChaining":   { "enabled": true },
    "anyUnknown":         { "enabled": true },
    "typeAssertions":     { "enabled": true, "allowConst": true, "allowBrandedTypes": true, "exemptions": { "allowedTypes": [] } },
    "doubleBang":         { "enabled": true },
    "enums":              { "enabled": true },
    "exhaustiveSwitches": { "enabled": true },
    "fallthroughGrouping": { "enabled": true },
    "productSwitchMatrix": { "enabled": true, "minRepeatedReturnKind": 3 },
    "stateBranching":     { "enabled": true, "exemptions": { "allowedFiles": [], "allowedDirectories": [] } },
    "resultPatterns":     { "enabled": true, "bannedNames": ["Success", "Failed", "Ok", "Error"] },
    "ifOnField":          { "enabled": true, "suspiciousNames": [] },
    "positionalArgs":     { "enabled": true, "exemptPrivateFunctions": true, "exemptFunctions": [] }
  },
  "projectOverrides": {
    "exemptFunctions": [],
    "exemptTypes": []
  }
}
```

### ignorePaths

Skip entire directories or files. Each entry requires both `path` (substring match, case-insensitive) and `reason` (why this path is exempt). No blind exclusions.

Common exclusions:
- Generated code (protobuf, GraphQL codegen, Roblox moon modules)
- Vendored third-party code
- FFI boundary files
- Legacy modules being migrated incrementally

### Rules reference

| Rule | What it bans | Common exemption reason |
|---|---|---|
| `booleanFields` | `isX`, `hasX` boolean fields | TSX component props (`disabled`, `loading`, `checked`) — use `tsxFiles: true` |
| `booleanParams` | Boolean function parameters | Private helper functions — use `privateFunctions: true` |
| `booleanReturns` | Functions returning boolean | Rare; usually means the function should return a DU |
| `nullUndefined` | `null`, `undefined`, `?:` params | API boundaries — mark with `@api-boundary` comment |
| `optionalProperties` | Optional properties (`prop?:`) | API response types — mark with `@api-boundary` comment |
| `optionalChaining` | `?.` operator | Disable if codebase has many external API responses |
| `anyUnknown` | `any`, `unknown` types | Should almost never be exempted |
| `typeAssertions` | `as Type` casts | `as const` and branded types allowed by default |
| `doubleBang` | `!!value` coercion | Disable if migrating legacy code |
| `enums` | TypeScript enums | Disable if project convention uses enums |
| `exhaustiveSwitches` | Non-exhaustive switch on unions | Rarely needs exemption |
| `productSwitchMatrix` | Nested DU product matrices that repeatedly return the same Kind | Raise `minRepeatedReturnKind` only for generated exhaustive matrix code |
| `stateBranching` | `else if`, state if/return ladders, nullish-combination ladders, equality ternaries | Narrow presentation/framework files only; use `allowedFiles` / `allowedDirectories` |
| `resultPatterns` | Banned result type names | Add project-specific names to `bannedNames` |
| `ifOnField` | `if (obj.field)` truthy checks | Add field names to `suspiciousNames` for stricter checking |
| `positionalArgs` | Functions with 3+ positional args | Private functions exempted by default |

### Merge behavior

- You only need to include rules you want to change. Omitted rules keep their defaults.
- Exemption arrays are **merged** (your entries added to defaults), not replaced.
- Set `"enabled": false` to fully disable a rule.

## Step 1 — Check for existing config

Read `.claude/ai-lab/perfect-typescripter/config.json` at the project root if it exists. Preserve existing overrides.

## Step 2 — Determine what to change

If you're here because a hook blocked a write, identify which rule fired from the error message and add the minimum exemption needed. Prefer exemptions over disabling entire rules.

Common patterns:
- Entire directory needs exemption → `"ignorePaths": [{ "path": "src/moon", "reason": "Roblox moon module with external API types" }]`
- Roblox-ts project with boolean props everywhere → `"booleanFields": { "exemptions": { "tsxFiles": true } }`
- API client consuming external REST API → `"nullUndefined": { "enabled": false }` or mark boundaries with `@api-boundary`
- Legacy codebase migration → disable specific rules incrementally
- Framework requiring enums → `"enums": { "enabled": false }`

When the right config change isn't obvious, use AskUserQuestion. Present the candidate changes as options (e.g., "Disable rule X", "Add exemption for Y", "Exclude path Z"), mark the one that fixes the blocked write with the least enforcement loss as "(Recommended)", and describe for each option what TypeScript patterns it allows through and what correctness checks the user loses.

## Step 3 — Write the config

Write `.claude/ai-lab/perfect-typescripter/config.json` at the project root. Only include rules that differ from defaults to keep the config minimal.

## Step 4 — Verify (MANDATORY)

This step is non-optional. Skipping it means a malformed config silently fails to load, and the user discovers the regression next time the guard fires unexpectedly.

1. Confirm `.claude/ai-lab/perfect-typescripter/config.json` exists and parses as valid JSON (run `node -e "JSON.parse(require('fs').readFileSync('.claude/ai-lab/perfect-typescripter/config.json','utf8'))"` and confirm no error).
2. Run a TypeScript type-check to confirm the project still compiles after any related code edits. Detection order:
   - If `package.json` has a `"type-check"` script: `npm run type-check` (or `pnpm`/`yarn` per the lockfile present)
   - Otherwise: `npx tsc --noEmit` from the project root
3. Do NOT report success until the type-check exits 0. If it fails, fix the underlying issue, do not report "done" with a failing type-check, and do not weaken the config to mask the failure.
4. Tell the user which rules were changed and what `tsc --noEmit` reported.
