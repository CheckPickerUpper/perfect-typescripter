// OpenCode plugin entry point for perfect-typescripter.
// Fans tool.execute.before and tool.execute.after events out to the
// canonical Claude-shape hook scripts under ../hooks/, after translating
// the OpenCode payload to the Claude-hook JSON contract.

import nodeFs from "node:fs"
import nodePath from "node:path"
import { fileURLToPath } from "node:url"
import mapPayloadModule from "./lib/map-opencode-payload-to-claude.js"
import runCanonicalHookModule from "./lib/run-canonical-hook.js"

const { buildClaudePayloads, matcherAcceptsClaudeToolName } = mapPayloadModule
const { runCanonicalHook } = runCanonicalHookModule

// Resolve through the symlink OpenCode installs at ~/.config/opencode/plugins/,
// so relative paths point back at the actual plugin source directory.
const bundleAbsolute = nodeFs.realpathSync(fileURLToPath(import.meta.url))
const bundleDir = nodePath.dirname(bundleAbsolute)
const pluginRoot = nodePath.resolve(bundleDir, "..")

const PLUGIN_NAME = "perfect-typescripter"
const WRITE_MATCHER = [
  "Edit",
  "Write",
  "MultiEdit",
  "mcp__filesystem__write_file",
  "mcp__filesystem__edit_file",
  "mcp__serena__replace_symbol_body",
  "mcp__serena__insert_after_symbol",
  "mcp__serena__insert_before_symbol",
  "mcp__serena__replace_content",
].join("|")

const ROWS = [
  {
    opencodeEvent: "tool.execute.before",
    claudeEvent: "PreToolUse",
    scriptPathRelative: "hooks/config_write_guard.js",
    matcher: WRITE_MATCHER,
    timeoutMs: 5000,
  },
  {
    opencodeEvent: "tool.execute.before",
    claudeEvent: "PreToolUse",
    scriptPathRelative: "hooks/typescript_guard.js",
    matcher: WRITE_MATCHER,
    timeoutMs: 5000,
  },
  {
    opencodeEvent: "tool.execute.before",
    claudeEvent: "PreToolUse",
    scriptPathRelative: "hooks/why_tag_guard.js",
    matcher: WRITE_MATCHER,
    timeoutMs: 5000,
  },
]

function fanOutOneEvent({ rows, opencodeToolName, opencodeArgs }) {
  const built = buildClaudePayloads({ opencodeToolName, opencodeArgs, cwd: process.cwd() })
  if (built.kind === "unsupported") return { kind: "allow" }
  for (const claudePayload of built.payloads) {
    for (const row of rows) {
      if (!matcherAcceptsClaudeToolName(row.matcher, claudePayload.tool_name)) continue
      const decision = runCanonicalHook({
        scriptPath: nodePath.join(pluginRoot, row.scriptPathRelative),
        pluginRoot,
        claudePayload,
        defaultReason: `Blocked by ${PLUGIN_NAME}.`,
        timeoutMs: row.timeoutMs,
      })
      if (decision.kind === "deny") {
        return { kind: "deny", reason: `[${PLUGIN_NAME}] ${decision.reason}` }
      }
    }
  }
  return { kind: "allow" }
}

const beforeRows = ROWS.filter((row) => row.opencodeEvent === "tool.execute.before")
const afterRows = ROWS.filter((row) => row.opencodeEvent === "tool.execute.after")

export const PerfectTypescripterOpencodeBundle = async () => {
  console.log(`[${PLUGIN_NAME}-opencode] loaded. before=${beforeRows.length} after=${afterRows.length}`)
  return {
    "tool.execute.before": async (input, opencodeToolResult) => {
      const decision = fanOutOneEvent({
        rows: beforeRows,
        opencodeToolName: input.tool,
        opencodeArgs: opencodeToolResult.args,
      })
      if (decision.kind === "deny") throw new Error(decision.reason)
    },
    "tool.execute.after": async (input, opencodeToolResult) => {
      fanOutOneEvent({
        rows: afterRows,
        opencodeToolName: input.tool,
        opencodeArgs: opencodeToolResult.args,
      })
    },
  }
}
