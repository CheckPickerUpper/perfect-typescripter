# Perfect TypeScripter — Full Rule Reference

This reference covers the write-time hooks, cross-file lint rules, configuration, examples, and troubleshooting. For installation, see the [README](../README.md).

## The Problem

TypeScript's flexibility leads to runtime errors:
- Optional fields → `undefined` crashes
- Boolean parameters → unclear meaning
- `null`/`undefined` → "Cannot read property of undefined"
- `any`/`unknown` → type safety escape hatches
- Positional parameters → unclear call sites

**Result:** TypeScript that compiles but crashes at runtime.

## The Solution

**Rust-inspired type discipline:**

### 1. No Optional Fields
Use discriminated unions to make presence/absence explicit.

❌ **Blocked:**
```typescript
type User = {
  name: string;
  email?: string;  // Might be undefined!
};

function greet(user: User) {
  console.log(user.email.toLowerCase()); // Runtime error
}
```

✅ **Correct:**
```typescript
type User =
  | { hasEmail: true; name: string; email: string }
  | { hasEmail: false; name: string };

function greet(user: User) {
  if (user.hasEmail) {
    console.log(user.email.toLowerCase()); // Type-safe
  }
}
```

---

### 2. No Boolean Parameters
Booleans hide meaning at call sites.

❌ **Blocked:**
```typescript
function createUser(name: string, isAdmin: boolean) {
  // ...
}

createUser("Alice", true); // What does true mean?
```

✅ **Correct:**
```typescript
type UserRole = "admin" | "user";

function createUser(name: string, role: UserRole) {
  // ...
}

createUser("Alice", "admin"); // Clear!
```

---

### 3. No `null` or `undefined`
Use discriminated unions for "might not exist".

❌ **Blocked:**
```typescript
function findUser(id: string): User | null {
  // ...
}

const user = findUser("123");
console.log(user.name); // Might crash
```

✅ **Correct:**
```typescript
function findUser(id: string): 
  | { found: true; user: User }
  | { found: false } {
  // ...
}

const result = findUser("123");
if (result.found) {
  console.log(result.user.name); // Type-safe
}
```

---

### 4. No `any` or `unknown`
Every value must have a known type.

❌ **Blocked:**
```typescript
function processInput(data: any) {
  return data.value; // No type safety
}

function parseJson(input: string): unknown {
  return JSON.parse(input); // Escape hatch
}
```

✅ **Correct:**
```typescript
type Input = { value: string };

function processInput(data: Input) {
  return data.value; // Type-safe
}

function parseJson<T>(
  input: string,
  guard: (data: unknown) => data is T
): T | { error: string } {
  try {
    const parsed: unknown = JSON.parse(input);
    if (guard(parsed)) {
      return parsed;
    }
    return { error: "Validation failed" };
  } catch {
    return { error: "Parse failed" };
  }
}
```

---

### 5. No Positional Parameters (>1)
More than one parameter → use object.

❌ **Blocked:**
```typescript
function createOrder(
  userId: string,
  productId: string,
  quantity: number,
  coupon: string
) {
  // Call site: createOrder("u1", "p2", 3, "SAVE10")
  // Which is which?
}
```

✅ **Correct:**
```typescript
type CreateOrderParams = {
  userId: string;
  productId: string;
  quantity: number;
  coupon: string;
};

function createOrder(params: CreateOrderParams) {
  // Call site:
  // createOrder({
  //   userId: "u1",
  //   productId: "p2",
  //   quantity: 3,
  //   coupon: "SAVE10"
  // });
  // Clear and self-documenting!
}
```

## Rules

### Banned Types
- `?` (optional fields)
- `boolean` (use string literal unions)
- `null` (use discriminated unions)
- `undefined` (use discriminated unions)
- `any` (use concrete types)
- `unknown` (use type guards)

### Banned Patterns
- Optional chaining (`?.`) without discriminated union
- Nullish coalescing (`??`) without discriminated union
- Non-null assertion (`!`) 
- State branching through `else if`, consecutive `if`/`return` ladders, nullish-combination parser ladders, or equality ternaries
- Nested previous/next DU product matrices that repeatedly return the same `Kind`
- Positional parameters (>1 parameter without object)

### Required Patterns
- Discriminated unions for "might not exist"
- String literal unions for enums
- Exhaustive `switch` for state/domain branching
- Relationship DUs for previous/next state transitions
- Type guards for external data
- Object parameters for multi-argument functions

### Cluster Rules (v1.27.0, from No Boilerplate z-0-bbc80JM)

Two structural rules, both type-based so rename-proof.

- **BOOL CLUSTER** (v1.26.0): 2+ `boolean` fields in one interface/type. Replace with a discriminated union (the "dead cat can't be hungry" pattern).
- **SAME-TYPE CLUSTER** (v1.27.0): 3+ fields of identical non-primitive type (or 5+ of a primitive like `string`, `number`, `boolean`) in one interface/type. Example: `interface Team { attacker: Player; defender: Player; goalie: Player; }` fires because three `Player` fields are a collection pretending to be named slots. Use `Player[]`, a fixed tuple, or `Record<Role, Player>`. v1.27.0 replaced the v1.26.0 naming-based rules (PREFIX CLUSTER, AUDIT CLUSTER, NUMBERED SUFFIX) because those were bypassable by renaming.

### Phantom Type Parameter (v1.33.0)

Generic type parameters declared in a `<...>` list but never referenced in the body of the type / interface / class / function are denied. A phantom param pretends to constrain but doesn't.

```typescript
// denied — TKind is declared but never used in the body
type WorldStateRegistry<TKind, TUpsertPayload, TRemoveAnnouncement> = {
  upsert: (payload: TUpsertPayload) => void;
  remove: (announcement: TRemoveAnnouncement) => void;
};
// callers can pass `WorldStateRegistry<"A", X, Y>` or `WorldStateRegistry<"B", X, Y>`
// interchangeably — the type system has nothing to check against.

// allowed — every param is referenced in the body
type WorldStateRegistry<
  TKind extends string,
  TUpsertPayload,
  TRemoveAnnouncement,
> = {
  kind: TKind;
  upsert: (payload: TUpsertPayload) => void;
  remove: (announcement: TRemoveAnnouncement) => void;
};
```

The detector strips comments and string literals before counting word-bounded occurrences of each param name in the declaration text (header through closing brace for interface / class / function, header through terminating semicolon for type alias). `=>` is skipped as a token so an arrow function type in a type alias RHS does not prematurely close the alias.

Configurable via `rules.phantomTypeParams.exemptions.typeParamNames` for branded-phantom markers.

For linting unused generic parameters, enable [`@typescript-eslint/no-unused-vars`](https://typescript-eslint.io/rules/no-unused-vars/). [Bun enables its built-in TypeScript `no-unused-vars` rule by default](https://bun.com/docs/lint#default-rules). With the TypeScript compiler, enable [`noUnusedParameters`](https://www.typescriptlang.org/tsconfig/noUnusedParameters.html) to catch unused type parameters, including those on exported declarations. [`noUnusedLocals`](https://www.typescriptlang.org/tsconfig/noUnusedLocals.html) checks unused local declarations.

### State Branching (v1.35.0)

Domain state cannot branch through anonymous `if` ladders. The guard blocks `else if`, consecutive `if (...) return ...` ladders over discriminants like `kind` / `type` / `tag`, nullish-combination parser ladders over multiple fields, and equality ternaries such as `state.Kind === "Loading" ? a : b`.

```typescript
// denied
if (error.kind === "network") {
  return normalizeNetwork(error);
}
if (error.kind === "parse") {
  return normalizeParse(error);
}
return normalizeHttp(error);

// allowed
switch (error.kind) {
  case "network":
    return normalizeNetwork(error);
  case "parse":
    return normalizeParse(error);
  case "http":
    return normalizeHttp(error);
}
```

The fix is to classify raw boundary input into a discriminated union once, then switch on the variant. Narrow path/file exemptions live under `rules.stateBranching.exemptions.allowedFiles` and `allowedDirectories`.

### Product Switch Matrix (v1.36.0)

Nested discriminant switches over previous/next-style unions get flagged when the inner switch returns the same `{ Kind: "..." }` from 3 or more case bodies. That pattern satisfies ordinary exhaustive-switch rules while still hand-writing a product matrix over two DUs.

```typescript
// denied
switch (next.Kind) {
  case "Idle":
    switch (previous.Kind) {
      case "Charging":
        return { Kind: "PhaseChanged", previous, next };
      case "Overcharging":
        return { Kind: "PhaseChanged", previous, next };
      case "Active":
        return { Kind: "PhaseChanged", previous, next };
    }
}

// allowed
const transition = classifySnapshotTransition({ previous, next });
switch (transition.Kind) {
  case "StayedSame":
    return transition;
  case "PhaseChanged":
    return transition;
}
```

The fix is to classify the relationship once into a named relationship DU, then switch on that relationship. If the downstream caller only runs effects, compile the rich transition into an actionable command shape before the side-effect runner.

### Cross-file rules

The per-file PreToolUse hook only sees one file at a time, so it cannot catch:

- **Identical envelope shapes** across N+ type aliases / interfaces (`{entityID, OccurredAtGameTime, Reason}` repeated 10 times across `*RemoveAnnouncement`)
- **Shared variant literals** across DUs (`OwnerLeft` appearing in `CharacterRemoveReason`, `SummonRemoveReason`, `CompanionRemoveReason`)
- **Prefix drift** between sibling DUs (`PlayerLeft` vs `OwnerLeft` for the same domain operation)

These rules run in Bun lint or ESLint through `eslint-plugin-perfect-typescripter`. See [Cross-file enforcement](#cross-file-enforcement) for installation and configuration.

### String Widening of Literal Unions (v1.30.0)

Type aliases that union a literal-string union (or anything with a `"..."` literal) with bare `string` are denied. TypeScript silently collapses `LiteralUnion | string` to plain `string`, so every exhaustive `switch` over the alias becomes unsafe with no compile warning.

```typescript
// denied
type StepKind = AbilityStep["Kind"] | string;
type Foo = "a" | "b" | string;
type Bar = string | "primary";

// allowed (legitimate primitive widening, no literal to collapse)
type Z = string | number;
```

Fix: widen the upstream wire / source type to carry the real typed kind, then keep the consumer-side alias narrow (drop the `| string`). For genuine freeform-text-with-hint-literals (e.g. autocomplete suggestion APIs), add `// @why widen` to the type-alias declaration. The escape comment tag is configurable via `rules.stringWidening.exemptions.commentTag`.

## Use Cases

### API Response Handling

❌ **Before:**
```typescript
type ApiResponse = {
  data?: User;
  error?: string;
};

async function fetchUser(id: string): Promise<ApiResponse> {
  // ...
}

const response = await fetchUser("123");
if (response.data) {
  // data exists
} else if (response.error) {
  // error exists
} else {
  // Both undefined? What happened?
}
```

✅ **After:**
```typescript
type ApiResponse =
  | { status: "success"; data: User }
  | { status: "error"; error: string };

async function fetchUser(id: string): Promise<ApiResponse> {
  // ...
}

const response = await fetchUser("123");
switch (response.status) {
  case "success":
    // response.data is User
    break;
  case "error":
    // response.error is string
    break;
}
```

---

### State Management

❌ **Before:**
```typescript
type State = {
  isLoading: boolean;
  data?: Data;
  error?: Error;
};

// Illegal states possible:
// - isLoading=true with data
// - data AND error both present
```

✅ **After:**
```typescript
type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: Data }
  | { status: "error"; error: Error };

// Impossible to have conflicting states
```

---

### Form Validation

❌ **Before:**
```typescript
type FormState = {
  isValid: boolean;
  errors?: string[];
};

// Can have isValid=true with errors present!
```

✅ **After:**
```typescript
type FormState =
  | { state: "valid" }
  | { state: "invalid"; errors: string[] };

// Type system prevents invalid combinations
```

---

### Database Queries

❌ **Before:**
```typescript
async function getUser(id: string): Promise<User | null> {
  // ...
}

const user = await getUser("123");
if (user) {
  // ...
} else {
  // Was it not found? Or database error? Who knows.
}
```

✅ **After:**
```typescript
type QueryResult<T> =
  | { found: true; value: T }
  | { found: false; reason: "not-found" | "db-error" };

async function getUser(id: string): Promise<QueryResult<User>> {
  // ...
}

const result = await getUser("123");
if (result.found) {
  console.log(result.value.name);
} else {
  console.error(`User not found: ${result.reason}`);
}
```

## Configuration

Use `/setup-typescripter-config` to scaffold or edit the config interactively, or create `.claude/ai-lab/perfect-typescripter/config.json` manually in your project root. Since 1.28.1 the skill's verify step is MANDATORY: after writing the config it validates the JSON parses and runs `npm run type-check` (or `npx tsc --noEmit`), and will not report success until the type-check exits 0.

```json
{
  "ignorePaths": [
    { "path": "src/generated", "reason": "auto-generated types from external schema" }
  ],
  "rules": {
    "booleanFields":      { "enabled": true, "exemptions": { "fieldNames": ["Enabled"], "typeNames": [], "tsxFiles": true } },
    "booleanParams":      { "enabled": true, "exemptions": { "privateFunctions": true } },
    "booleanReturns":     { "enabled": true },
    "nullUndefined":      { "enabled": true, "exemptions": { "functionNames": ["GetBrain"], "commentTag": "@api-boundary" } },
    "optionalProperties": { "enabled": true, "exemptions": { "commentTag": "@api-boundary" } },
    "optionalChaining":   { "enabled": true },
    "anyUnknown":         { "enabled": true },
    "typeAssertions":     { "enabled": true, "allowConst": true, "allowBrandedTypes": true, "exemptions": { "allowedTypes": ["LifeStateAttributes"] } },
    "doubleBang":         { "enabled": true },
    "enums":              { "enabled": true },
    "exhaustiveSwitches": { "enabled": true },
    "fallthroughGrouping": { "enabled": true },
    "productSwitchMatrix": { "enabled": true, "minRepeatedReturnKind": 3 },
    "stateBranching":     { "enabled": true, "exemptions": { "allowedFiles": [], "allowedDirectories": [] } },
    "resultPatterns":     { "enabled": true, "bannedNames": ["Success", "Failed", "Ok", "Error"] },
    "positionalArgs":     { "enabled": true, "exemptPrivateFunctions": true, "exemptFunctions": ["myFrameworkCallback"] }
  },
  "projectOverrides": {
    "exemptFunctions": [],
    "exemptTypes": []
  }
}
```

### Structural boundary behavior (no config needed)

Two rules read the library boundary from the file's structure, so the common framework-interop false positives never need an exemption entry:

- **`nullUndefined` / `optionalChaining`** — in any file that imports an external package (a bare module specifier like `react-hook-form`, not a relative `./` or alias `@/` path), `| undefined` / `| null` in a function signature or value annotation, and `?.` reads, are treated as forwarding upstream library shapes and do not fire. `nullUndefined` still fires on `type X = ... | undefined` / `interface X { foo: ... | undefined }` declarations inside the same file — those are user-declared shapes. The allowance is import-gated: it cannot be turned on without a real import of a real package.
- **`positionalArgs`** — a `name: (...) => ...` callback property whose object literal is passed as a call argument (e.g. `useJakutaResultQuery({ endpointFn: (client, args) => ... })`) does not fire. That callback's signature is contextually typed by the callee, so it is not an API the author declares. A standalone object's method (`const api = { doThing: (a, b) => ... }`) still fires.

### Per-Rule Exemptions

**`nullUndefined.exemptions`:**
- `functionNames` — functions allowed to return `| null` or `| undefined` (e.g., Roblox APIs that return nil)
- `commentTag` — annotate any line with `// @api-boundary` to exempt it

**`typeAssertions.exemptions`:**
- `allowedTypes` — specific types allowed in `as X` assertions (e.g., `LifeStateAttributes`)
- `allowConst` — allow `as const` (default: true)
- `allowBrandedTypes` — allow `as FooId` branded types (default: true)

**`optionalProperties.exemptions`:**
- `commentTag` — annotate with `// @api-boundary` to exempt

**`positionalArgs.exemptFunctions`:**
- Function names whose multi-param signatures are dictated by a framework runtime (e.g., a custom serverless handler). Built-in exemptions already cover Cloudflare Workers (`fetch`, `scheduled`, `queue`, `tail`, `trace`, `email`), Express/Koa (`middleware`), AWS Lambda (`handler`), Redux (`reducer`), Array.sort (`compare`, `compareFn`, `comparator`), GraphQL (`resolve`), and React.forwardRef (`render`).

**`stateBranching.exemptions`:**
- `allowedFiles` and `allowedDirectories` — narrow exemptions for files where a presentation adapter or framework callback owns an unavoidable branch. Do not use this for app/API/request/auth state; those should be discriminated unions plus `switch`.

**`productSwitchMatrix`:**
- `minRepeatedReturnKind` — repeated returned `Kind` threshold before nested previous/next discriminant switches fire. Default: `3`.

**`projectOverrides`:**
- `exemptFunctions` — globally exempt function names from null/undefined checks
- `exemptTypes` — globally exempt type names from assertion checks
```

### Strictness Levels

| Level | Effect |
|-------|--------|
| `low` | Only ban `any`, `null` |
| `medium` | + ban optionals, `undefined` |
| `high` | + ban booleans, enforce positional params (default) |
| `paranoid` | + ban all escape hatches, no exemptions |

### Positional Params Threshold

```json
{
  "positionalParamsThreshold": 1
}
```

**Means:**
- 0 or 1 params → allowed
- 2+ params → must use object

**Set to 2 if you want to allow 2 params:**
```json
{
  "positionalParamsThreshold": 2
}
```

## Detection Patterns

### Optional Fields
```typescript
type T = { field?: string };       // ❌
type T = { field: string | undefined }; // ❌
```

### Booleans
```typescript
type T = { flag: boolean };        // ❌
function fn(enabled: boolean) { }  // ❌
```

### Null/Undefined
```typescript
type T = { field: string | null }; // ❌
function fn(): User | undefined { }// ❌
```

### Any/Unknown
```typescript
const x: any = data;               // ❌
function fn(): unknown { }         // ❌
```

### Optional Chaining
```typescript
const name = user?.name;           // ❌ (without discriminated union)
```

### Positional Params
```typescript
function fn(a: string, b: number, c: boolean) { } // ❌ (3 params)
```

## Examples

### Before Enforcement

```typescript
type User = {
  id: string;
  name: string;
  email?: string;
  isActive: boolean;
};

type ApiResponse = {
  data?: User;
  error?: string;
};

async function fetchUser(
  userId: string,
  includeEmail: boolean
): Promise<User | null> {
  try {
    const response = await api.get(`/users/${userId}`);
    return response.data?.user ?? null;
  } catch (error: any) {
    console.error(error.message);
    return null;
  }
}

const user = await fetchUser("123", true);
if (user && user.isActive) {
  console.log(user.email?.toLowerCase() ?? "No email");
}
```

**Problems:**
- Optional `email` field
- Boolean `isActive` and `includeEmail`
- `any` for error
- `null` return
- Optional chaining
- Positional parameters
- Nullish coalescing

### After Enforcement

```typescript
type User =
  | { hasEmail: true; id: string; name: string; email: string; status: "active" }
  | { hasEmail: true; id: string; name: string; email: string; status: "inactive" }
  | { hasEmail: false; id: string; name: string; status: "active" }
  | { hasEmail: false; id: string; name: string; status: "inactive" };

type ApiResponse =
  | { status: "success"; user: User }
  | { status: "error"; error: string };

type FetchUserParams = {
  userId: string;
  includeEmail: "yes" | "no";
};

async function fetchUser(
  params: FetchUserParams
): Promise<ApiResponse> {
  try {
    const response = await api.get(`/users/${params.userId}`);
    if (isUser(response.data.user)) {
      return { status: "success", user: response.data.user };
    }
    return { status: "error", error: "Invalid user data" };
  } catch (error) {
    if (error instanceof Error) {
      return { status: "error", error: error.message };
    }
    return { status: "error", error: "Unknown error" };
  }
}

const result = await fetchUser({ userId: "123", includeEmail: "yes" });
if (result.status === "success") {
  const user = result.user;
  if (user.status === "active") {
    if (user.hasEmail) {
      console.log(user.email.toLowerCase());
    } else {
      console.log("No email");
    }
  }
}
```

**Improvements:**
- Discriminated unions throughout
- No optionals
- No booleans
- Explicit error types
- No `null`
- Object parameter
- Type-safe at every step

## Cross-file enforcement

`eslint-plugin-perfect-typescripter` runs the same three rules in Bun lint and ESLint:

| Rule | What it catches |
|------|-----------------|
| `perfect-typescripter/no-duplicate-envelope-shape` | Two or more type aliases or interfaces with identical property names and types, with at least two properties. Extract a generic envelope. |
| `perfect-typescripter/no-shared-variant-literal-across-discriminated-unions` | The same string literal in three or more separate union aliases, either as a bare variant or in a configured discriminator field. Extract a shared cause type. |
| `perfect-typescripter/no-variant-prefix-drift` | Bare string variants in different aliases disagree on the prefix for the same PascalCase suffix (`PlayerLeft` versus `OwnerLeft`). Choose the name that matches the domain. |

Remove `perfect-typescripter/no-phantom-type-param` from existing ESLint configs. Use the [unused-parameter checks described above](#phantom-type-parameter-v1330) for linting. The write-time phantom parameter hook still applies to agent edits.

### Project scope

For each linted `.ts`, `.tsx`, `.mts`, or `.cts` file, the rules search upwards from its directory for the nearest `tsconfig.json`. TypeScript's config parser resolves `files`, `include`, `exclude`, and `extends` to select the project files. Only declarations in that file list participate. Project references are not traversed.

Linting `b.ts` alone still reads matching declarations in `a.ts` and other project files. Findings belong to the linted file, so unlinted files do not gain diagnostics. Partner declarations appear in deterministic order with project-relative paths and line numbers.

The linter's text is used for the selected file, including unsaved editor changes. Bun's `--staged` selects paths staged in Git. Partner files are read from disk. The next lint refreshes the file list and contents, so edits, renames, and config changes affect its findings.

### Installation

Use the [README's local package installation](../README.md#cross-file-rules-bun-or-eslint) from the project root. It installs the plugin, ESLint, the TypeScript parser, and both TypeScript aliases. TypeScript 7's native compiler does not provide the JavaScript compiler API these rules need. `typescript@npm:@typescript/typescript6@latest` supplies that API, while `@typescript/cli@npm:typescript@latest` supplies the native `tsc` command. See [TypeScript's side-by-side installation instructions](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-6-0).

In Claude Code, the `setup-eslint-integration` skill starts setup when a TypeScript project has no ESLint config and you edit TypeScript or ask about linting. `/setup-eslint` runs setup explicitly. It installs missing dependencies, configures ESLint, and scaffolds a pre-commit hook. Existing declared dependencies are kept. Check their compatibility if setup reports a compiler API or parser error. Use `--no-precommit` to configure linting alone.

### Bun lint

With Bun 1.4.4, put this in `bunfig.toml`:

```toml
[lint]
plugins = ["eslint-plugin-perfect-typescripter"]

[lint.rules]
"perfect-typescripter/no-duplicate-envelope-shape" = "error"
"perfect-typescripter/no-shared-variant-literal-across-discriminated-unions" = "error"
"perfect-typescripter/no-variant-prefix-drift" = "error"
```

```bash
bun lint b.ts
bun lint --staged
```

Both commands use the nearest tsconfig project's declarations, even when only `b.ts` is selected. See [Bun's lint documentation](https://bun.com/docs/lint) for command options.

### ESLint

Create `eslint.config.mjs`:

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

The `recommended` preset sets all three rules to `warn`. These examples use `error` so findings fail the lint command.

### Rule options

Pass an options object after the severity, for example `["error", { "threshold": 4 }]` in ESLint or `["error", { threshold = 4 }]` in TOML.

| Rule | Options |
|------|---------|
| `no-duplicate-envelope-shape` | `threshold` (default `2`), `minFields` (default `2`), `ignoreNames` (declaration names, default `[]`). |
| `no-shared-variant-literal-across-discriminated-unions` | `threshold` (default `3`), `ignoreLiterals` (default `[]`), `discriminatorFieldNames` (default `["kind", "Kind", "tag", "Tag", "type", "Type"]`). |
| `no-variant-prefix-drift` | `ignoreSuffixes` (default `[]`). |

### Setup diagnostics

Each enabled rule reports setup problems at the start of the linted TypeScript file. JavaScript files do not trigger project setup diagnostics.

| Problem | Diagnostic details |
|---------|--------------------|
| Missing `tsconfig.json` | The starting directory and every config path searched upwards. |
| Missing or incompatible project-local `typescript` | The project root or resolved module path, the load failure or missing API members, and the compatibility install command. |
| Invalid TypeScript config | The config path and TypeScript diagnostic code and message, including the source file, line, and column when available. |
| Unreadable config or project file | The file path, I/O error code, and original cause. Other readable project files can still be analyzed when a partner file is unreadable. |

## Files

| Path | Purpose |
|------|---------|
| `hooks/typescript_guard.js` | PreToolUse hook — blocks Write/Edit on `.ts`/`.tsx` files that violate type rules |
| `hooks/config_write_guard.js` | PreToolUse hook — blocks AI write tools from editing the typescripter config after a rule denial instead of fixing the code that was denied |
| `hooks/ts-rules-inject.js` | SessionStart hook on `startup\|resume\|clear\|compact`. Detects whether the project has a `tsconfig.json` (or `.claude/ai-lab/perfect-typescripter/config.json`) and emits a short headline summary of the bans and mandates as additionalContext, so the rule shape is in context from the first message instead of waiting for the first `.ts` write to trigger skill auto-load. |
| `hooks/why_tag_guard.js` | PreToolUse hook, blocks Write/Edit on `.ts`/`.tsx`/`.js`/`.jsx`/`.mjs`/`.cjs` files that declare an exported function without a valid `@why` tag. Sites: exported functions only (`export function`, `export default function`, `export const NAME = (...) =>`, `export const NAME = function`). Bypass sites (`as any` / `as unknown`, `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck`, `eval`) were removed from @why scope in 1.24.0; those constructs are banned outright by the main `typescript_guard.js` and cannot be justified with `@why`. Earlier silent-failure sites (empty catch, return-after-guard, `process.exit(0)` in hooks, non-null `!`) were dropped earlier because they fired on legitimate code and trained weasel-blocklist workarounds. Grammar and required-sites list come from `plugins/why-tag/skills/why-tag-rules/SKILL.md`; valid tags must explain WHY with a purpose connector, not merely restate WHAT the function does. Exempts `*.test.*` and `*.spec.*` files. |
| `skills/typescript-rules/SKILL.md` | Auto-loaded skill with the full rule reference for the AI |
| `config/default.json` | Default rule configuration shipped with the plugin |
| `commands/setup-eslint.md` | Slash command `/setup-eslint`. Manual escape hatch that does the same thing as the agent. |
| `agents/eslint-installer.md` | Subagent that runs the orchestrator, dry-runs first, applies, verifies with `npx eslint .`, reports with TANTO markers. Spawned by the `setup-eslint-integration` skill (proactive) or callable directly. |
| `skills/setup-eslint-integration/SKILL.md` | Auto-loading skill. Fires when the project is TS, has no ESLint config, and the user has perfect-typescripter installed. Spawns the `eslint-installer` agent without asking, so cross-file rule wiring happens before drift accumulates. |
| `eslint-plugin/` | Bundled-local ESLint plugin shipped via `file:` protocol. Holds the three cross-file rules (`no-duplicate-envelope-shape`, `no-shared-variant-literal-across-discriminated-unions`, `no-variant-prefix-drift`) plus the `recommended` config preset. |
| `lib/setup-eslint/init-eslint-orchestrator.js` | Entry point for `/setup-eslint`. Detects, installs, merges, scaffolds, prints summary. Idempotent + non-destructive. Flags: `--no-precommit`, `--dry-run`. |
| `lib/setup-eslint/find-package-root.js` | Walks up from cwd to nearest `package.json`. |
| `lib/setup-eslint/detect-package-manager.js` | Detects npm / pnpm / yarn / bun by lockfile, or `packageManager` field in `package.json`. |
| `lib/setup-eslint/detect-eslint-config-style.js` | Detects flat / legacy / none ESLint config in the project root. |
| `lib/setup-eslint/install-eslint-dependencies.js` | Fresh installs include ESLint, the TypeScript parser, TypeScript API and native compiler aliases, husky, lint-staged, and the local plugin. Existing declared dependencies are kept. |
| `lib/setup-eslint/merge-flat-eslint-config.js` | Writes a fresh `eslint.config.js` if none exists, or a sibling `eslint.config.perfect-typescripter.js` if one does (refuses to AST-rewrite a JS export that may be dynamic). |
| `lib/setup-eslint/merge-legacy-eslint-config.js` | Merges rules into `.eslintrc.json` (JSON path only). For `.eslintrc.js` / `.cjs` / `.yaml`, prints a manual block instead of pretending to rewrite. |
| `lib/setup-eslint/scaffold-precommit-eslint-hook.js` | Scaffolds husky + lint-staged so `eslint --max-warnings 0` runs on staged `.ts` / `.tsx` at pre-commit. |

## When to Use

**Enable for:**
- Production applications
- Libraries (guarantees for users)
- Team projects (enforces discipline)
- Long-term maintained code

**Disable for:**
- Quick scripts
- Prototypes (too strict for exploration)
- Third-party integrations (external APIs use optionals/null)

## Troubleshooting

### "Too strict for my project"
- Lower `strictness` to `medium` or `low`
- Increase `positionalParamsThreshold` to 2 or 3
- Add exemptions for specific patterns

### "Conflicts with external libraries"
- Add library files to `exemptions.allowedFiles`
- Create wrapper types that translate external APIs

### "Discriminated unions are verbose"
- Use helper types: `type Result<T> = { ok: true; value: T } | { ok: false; error: string }`
- Create library of common patterns
- Trade verbosity for safety (prevents runtime errors)

## Philosophy

**Make illegal states unrepresentable.**

Inspired by Rust and functional programming:
- Types prove correctness at compile time
- Runtime errors become compile errors
- "Cannot read property of undefined" becomes impossible
- Code that compiles is correct

If TypeScript can't prove it's safe, don't allow it.

## Resources

- [Making Illegal States Unrepresentable](https://ybogomolov.me/making-illegal-states-unrepresentable)
- [Rust's Type System](https://doc.rust-lang.org/book/ch06-00-enums.html)
- [Parse, Don't Validate](https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/)

## License

MIT
