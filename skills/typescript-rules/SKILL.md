---
name: typescript-rules
description: "TypeScript enforcement rules. Auto-loads when Claude writes .ts or .tsx files so the rule context is in sight before the first line goes down. Contains the bans on null, undefined, optionals, booleans, any, unknown, enums, type assertions, and positional args; PreToolUse hooks enforce them and will block writes that violate them."
user-invocable: false
---

# TypeScript Enforcement Rules

The `typescript_guard.js` hook runs on every Write/Edit to `.ts` / `.tsx` files (not `.d.ts`) and denies writes that hit the rules below. The list is here so the rule is in context before the code is, not as a discovery surface.

A second hook, `why_tag_guard.js`, runs on the same trigger and enforces the `@why` tag at two surfaces in TS / JS (`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`): every exported function (`export function`, `export default function`, `export const NAME = (...) => ...`, `export const NAME = function`) and every load-bearing type-system bypass (`as any`, `as unknown`, `// @ts-ignore` / `@ts-expect-error` / `@ts-nocheck`, `eval`). Each site needs a `@why` doc-comment tag adjacent to it. The grammar (length ≥ 20, weasel blocklist, binding rules) lives in `plugins/why-tag/skills/why-tag-rules/SKILL.md` and is the single source of truth; if this file and the spec diverge, fix this file.

## Absolute Bans

| Pattern | Why | Fix |
|---------|-----|-----|
| `\| null` | Null should not exist in types | Discriminated union upstream |
| `\| undefined` | Same | Discriminated union upstream |
| `field?: type` | Optional properties hide missing data | Discriminated union with explicit variants |
| `?.` (optional chaining) | Means the type is wrong upstream | Fix the type so the field always exists |
| `?? ` (nullish coalescing) | Same | Fix upstream |
| `: any` | Erases all type safety | Explicit types or constrained generics |
| `: unknown` | Almost as bad | Explicit types (Tauri store exempt) |
| `: boolean` | Boolean blindness | Discriminated union: `{kind: 'yes'} \| {kind: 'no'}` |
| `enum X` | Enums are just numbers | Discriminated union: `type X = {kind: 'a'} \| {kind: 'b'}` |
| `as TypeName` | Bypasses compiler | Type guards or constructors (exempt: `as const`, branded `*Id` types) |
| `LiteralUnion \| string` | TS silently collapses to `string`, breaks downstream exhaustiveness | Widen the upstream wire / source type to carry the real typed kind; keep the consumer-side narrow. Escape hatch `// @why widen` for genuine freeform-text-with-hint-literals (autocomplete APIs). |
| `!` (non-null assertion) | Lies to compiler | Fix the type |
| `!!value` | Creates boolean blindness | Explicit discriminated union |

## Positional Arguments

Functions with two or more parameters take an object parameter so each argument is named at the call site:

```typescript
// denied
function create(name: string, age: number): User

// allowed
type CreateUserParams = { name: string; age: number };
function create(params: CreateUserParams): User
```

Exempt: private functions (prefixed with `_`).

## Boolean Exemptions

- Predicate functions (is*, has*, can*, should*, contains*, starts*, ends*, eq*, matches*) return boolean and that is fine **when the input is opaque** (number, string, branded `*Id`). When the input is a tagged union, the predicate collapses the union's variant information into one bit and forces the caller to recompute the lost cases — that is the degenerate-collapse rule below, and it fires regardless of the predicate-name exemption.
- `.tsx` files skip boolean field checks because React props often require booleans the library types as `boolean`.
- Specific field names can be exempted in `.claude/ai-lab/perfect-typescripter/config.json`.

## Degenerate Collapse (v1.28.0)

A function whose name matches the comparator pattern (`compare*`, `diff*`, `equals*`, `same*`, `isSame*`, `isEqual*`, `matches*`, `isMatch*`, `areSame*`, `areEqual*`) and whose return type is `boolean` or a 2-tag string-literal union (`"Same" | "Different"`, `"Match" | "NoMatch"`, etc.) is denied when its inputs include a non-primitive non-branded type. The reason: a 2-state answer over a tagged-union input destroys "how they differ," and every caller has to recompute the lost cases by switching on the inputs again. The instinct is then to write *more* comparators to "simplify" the resulting nested switch, multiplying the lie across files.

The fix is a **relationship DU**:

```typescript
// denied
function compareLoadoutSlots(a: LoadoutActiveSlot, b: LoadoutActiveSlot): "Same" | "Different"

// allowed — relationship DU whose variants enumerate the real outcomes
type SlotTransition =
  | { Kind: "NoTransition" }
  | { Kind: "ActivateOnly"; NextSlot: EquippedSlotName }
  | { Kind: "DeactivateOnly"; PreviousSlot: EquippedSlotName }
  | { Kind: "SwapSlots"; PreviousSlot: EquippedSlotName; NextSlot: EquippedSlotName };

function computeSlotTransition({ PreviousSlot, NextSlot }: { PreviousSlot: LoadoutActiveSlot; NextSlot: LoadoutActiveSlot }): SlotTransition
```

Callers switch flat on `transition.Kind` — no nested switch, no fall-through grouping, no information lost. The comparator is the symptom of a missing relationship DU; finding or defining the DU deletes the comparator.

Exemptions: branded ID comparisons (`isSameUserId(a: UserId, b: UserId): boolean`), primitive comparisons, and project-configured allow-lists in `.claude/ai-lab/perfect-typescripter/config.json` under `degenerateCollapse.exemptFunctions`. Equality on opaque IDs and primitives is genuinely binary; the rule fires only when the input type carries more shape than the answer admits.

## String Widening of Literal Unions (v1.30.0)

Type aliases that union a string-literal union (or anything containing a `"..."` literal) with bare `string` are denied:

```typescript
// denied — TS silently collapses each of these to plain `string`
type StepKind = AbilityStep["Kind"] | string;
type Foo = "a" | "b" | string;
type Bar = string | "primary";
type Baz =
  | "x"
  | "y"
  | string;
```

The collapse is invisible at the declaration site, but every exhaustive `switch` over the alias becomes unsafe: the compiler treats every branch as reachable, no warning fires, and the missing-case bug ships.

The structural fix: widen the upstream wire / source type to carry the real typed kind, then keep the consumer-side type narrow:

```typescript
// the wire boundary owns the kind set
type AbilityStep =
  | { Kind: "Cast"; ... }
  | { Kind: "Channel"; ... }
  | { Kind: "Hold"; ... };

// the consumer alias references the typed kind directly, no `| string`
type StepKind = AbilityStep["Kind"];   // "Cast" | "Channel" | "Hold"
```

The rule fires only when the RHS contains a top-level `string` member AND at least one string literal — `type Z = string | number` (legitimate primitive widening) is allowed.

Escape hatch (rare): if the value really is freeform-text-with-hint-literals — e.g. an autocomplete suggestion API where `"common"` and `"common-but-typed"` both need to round-trip — add `// @why widen` to the type-alias declaration and the rule passes through. Configurable via `rules.stringWidening.exemptions.commentTag` in `.claude/ai-lab/perfect-typescripter/config.json`.

## Result Patterns

Boolean fields with result-like names are denied (Success, Failed, IsSuccess, IsFailed, Ok, Error, IsError, IsValid, IsOk) because they hide the failure payload. The honest version:

```typescript
type Result<T, E> = { kind: 'success'; data: T } | { kind: 'failure'; error: E }
```

## Exhaustive Switches

Switch statements without a `default` case get flagged because they silently accept new variants when the union grows. Either handle every case or add an exhaustiveness guard.

## Fallthrough Grouping

Stacked case labels sharing one body (`case "A":\n  case "B":\n    break;`) get flagged. Every case must have its own body, even if the body is just `break;`. Two cases sharing one operation is a hint that the discriminated union upstream should collapse them into one variant; two cases with different field access, telemetry, or next-state must fan out one body per case. The grouped form hides which variant is actually intended for which behavior.

```ts
// BAD: grouped
switch (kind) {
  case "Player":
  case "Deployable":
    break;
}

// GOOD: fanned out
switch (kind) {
  case "Player":
    break;
  case "Deployable":
    break;
}
```

## State Branching

State/domain branching must use a discriminated union plus `switch`, not anonymous if ladders. The guard blocks:

- `else if` ladders over discriminants (`kind`, `Kind`, `type`, `_tag`, `tag`)
- consecutive `if (...) return ...` ladders that re-check the same state family
- nullish-combination parser ladders over 2+ fields and 3+ branches
- equality ternaries like `requestState === "loading" ? a : b`

The raw boundary parse may inspect text/JSON/presence once, but its output must be a named variant. Everything downstream switches on that variant.

## Product Switch Matrix

Nested discriminant switches over previous/next-style unions are denied when an inner switch returns the same `{ Kind: "..." }` from 3 or more case bodies. That shape is a hand-written product matrix over two DUs; it passes exhaustive switch checks but still hides the missing relationship DU.

The fix is to classify the previous/next relationship once into a named transition DU, then switch on that relationship. If the caller only needs side effects, compile the rich transition into an actionable command shape and keep no-op variants out of the side-effect runner.

## API Boundary Escape Hatch

Lines tagged with an `@api-boundary` comment skip null / undefined / optional checks. Use this for third-party API types you do not control; the boundary is the place those checks belong, not the call site.

## Structural library-boundary detection (no tag needed)

Two rules read the library boundary from file structure, so the common framework-interop false positives resolve without any tag or config entry:

- `nullUndefined` and `optionalChaining`: in a file that imports an external package (a bare module specifier such as `react-hook-form`, not a relative `./` or alias `@/` path), `| undefined` / `| null` in a function signature or value annotation, and `?.` reads, are treated as forwarding upstream library shapes and do not fire. `nullUndefined` still fires on `type X = ... | undefined` and `interface X { foo: ... | undefined }` declarations inside the same file, because those are shapes you declare. The allowance is import-gated; it cannot be switched on without a real import of a real package.
- `positionalArgs`: a `name: (...) => ...` callback property whose object literal is passed as a call argument has a signature contextually typed by the callee (`useJakutaResultQuery({ endpointFn: (client, args) => ... })`), so it is not an API you declare and does not fire. A standalone object method (`const api = { doThing: (a, b) => ... }`) still fires.

This is why a date-picker component or a react-hook-form adapter does not need a per-file allowlist entry: import the library and the signature-position checks already step back, while your own declared types stay enforced.

## The Core Principle

When a state is invalid, make it unrepresentable at the type level rather than blocking it at runtime. Reaching for `as`, wrappers, or type casts to silence the hook usually means the type itself is wrong; the discriminated union plus switch statement is what eliminates the illegal state.

## Cluster rules (from No Boilerplate z-0-bbc80JM, v1.27.0)

Two structural rules, both type-based so rename-proof.

BOOL CLUSTER fires on 2 or more `boolean` fields in one interface or type. Two bools yield 4 representable combinations; most are invalid (the "dead cat can't be hungry" example). Replace with a discriminated union whose variants carry only valid combinations.

SAME-TYPE CLUSTER fires on 3 or more fields of identical non-primitive type (or 5 or more of a primitive like `string`, `number`, `boolean`) in one interface or type. Example: `interface Team { attacker: Player; defender: Player; goalie: Player; }` fires because three `Player` fields are a collection pretending to be named slots. Use `Player[]`, a fixed tuple, or `Record<Role, Player>`. The rule reads types, not identifier spelling, so `slot1/slot2/slot3` and `first/second/third` both fire on the type repetition.

v1.27.0 replaced the earlier naming-based rules (PREFIX CLUSTER, AUDIT CLUSTER, NUMBERED SUFFIX) with SAME-TYPE CLUSTER after those turned out to be bypassable by renaming.

### Three pillars behind the cluster rules

The hooks enforce the letter. When code smells off but nothing fires, walk the three pillars the video calls out:

1. **Algebraic types**: correlated fields go into a discriminated union, not a struct. `{alive: boolean, hungry: boolean}` becomes `{kind: 'alive', hungry: boolean} | {kind: 'dead'}`.
2. **Normalization (3NF)**: fields that describe a sub-entity go on that sub-entity. `{authorName, authorEmail, authorId}` becomes `{author: Author}`. Repeating groups (`slot1`, `slot2`, `slot3`) become arrays.
3. **State machines**: states as a discriminated union, transitions as a separate union, valid transitions encoded as one exhaustive switch on `(state, event)`. The type system blocks out-of-order transitions; no runtime guard required.

## Project Config — .claude/ai-lab/perfect-typescripter/config.json

Place `.claude/ai-lab/perfect-typescripter/config.json` in the project root. No config = all rules on, no exemptions. All keys nest under `rules:`.

```json
{
    "rules": {
        "booleanFields": {
            "exemptions": {
                "fieldNames": ["customBoolField"],
                "typeNames": ["ThirdPartyProps"],
                "tsxFiles": true
            }
        },
        "typeAssertions": {
            "exemptions": {
                "allowedTypes": ["T", "EntityID", "string[]"],
                "allowedFiles": ["AdminRuntimeTypes.ts", "Condunet.Bus.ts"]
            }
        },
        "nullUndefined": {
            "exemptions": {
                "allowedFiles": ["ExternalApiTypes.ts"],
                "allowedDirectories": ["src/Shared/Client/UI/State"]
            }
        },
        "unknown": {
            "exemptions": {
                "allowedFiles": ["Condunet.Bus.ts"]
            }
        },
        "positionalArgs": {
            "exemptFunctions": ["myCustomFrameworkCallback"]
        },
        "productSwitchMatrix": {
            "enabled": true,
            "minRepeatedReturnKind": 3
        },
        "stateBranching": {
            "exemptions": {
                "allowedFiles": ["LegacyPresenter.ts"],
                "allowedDirectories": ["src/presentation/legacy"]
            }
        }
    }
}
```

### Config fields

- `booleanFields.exemptions.fieldNames` — field names that may be `boolean` (added on top of built-in defaults like `refreshing`, `editable`, etc.)
- `booleanFields.exemptions.typeNames` — type/interface names exempt from boolean field checks
- `booleanFields.exemptions.tsxFiles` — when `true` (default), `.tsx` files skip boolean field checks entirely
- `typeAssertions.exemptions.allowedTypes` — types that may appear in `as X` assertions (e.g. branded ID types, generic params)
- `typeAssertions.exemptions.allowedFiles` — files where `as` assertions are allowed (e.g. generic buses, runtime type dispatch)
- `nullUndefined.exemptions.allowedFiles` — files where `| null`, `| undefined`, `?.`, `??` are allowed
- `unknown.exemptions.allowedFiles` — files where `: unknown` is allowed
- `positionalArgs.exemptFunctions` — additional function names exempt from the params-struct rule (on top of built-in framework exemptions: `fetch`, `scheduled`, `queue`, `tail`, `trace`, `email` for Cloudflare Workers; `middleware` for Express/Koa; `handler` for AWS Lambda; `reducer` for Redux; `compare`/`compareFn`/`comparator` for Array.sort; `resolve` for GraphQL; `render` for React.forwardRef)
- `stateBranching.exemptions.allowedFiles` / `allowedDirectories` — narrow presentation/framework exemptions from STATE BRANCHING. App/API/request/auth/domain state should not be exempted.
- `productSwitchMatrix.minRepeatedReturnKind` — repeated returned `Kind` threshold before nested previous/next discriminant switches fire. Default: `3`.
- `<rule>.exemptions.allowedDirectories` — directory paths (e.g. `"src/Shared/Client/UI/State"`) that exempt all files under them from that rule. Works on any rule that supports `allowedFiles`. Uses substring match on the normalized file path.

### Third-party library boundaries

When a library forces `boolean` in its prop types (e.g. React Native's `RefreshControl` requires `refreshing: boolean`), the correct pattern is:

1. Use a discriminated union internally: `type RefreshState = {kind: 'idle'} | {kind: 'refreshing'}`
2. Convert at the boundary: `refreshing={state.kind === 'refreshing'}`
3. If the field name isn't in the built-in defaults, exempt it in config: add it to `booleanFields.exemptions.fieldNames`

Common RN boolean props (`refreshing`, `editable`, `multiline`, `scrollEnabled`, `secureTextEntry`, etc.) are exempt by default — no config needed.

### When the hook fires on a legitimate case

If the hook denies a write and the code looks correct (a generic bus, a framework boundary, an existing pattern in the project), the right next step is the config in `.claude/ai-lab/perfect-typescripter/config.json`. Add the file or type to the matching exemption list and re-run the write. Rewriting the code to dodge the pattern usually trades one rule violation for a worse design; the exemption list exists for the cases the rules cannot foresee.
