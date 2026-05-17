const fs = require('fs');
const path = require('path');

// Single source of truth for every write-tool surface, builtin + MCP, across
// Claude Code / Codex / OpenCode. JS-side derivations (the MCP_WRITE_TOOLS set,
// the matcher alternation string, and the per-tool payload normalizer) all
// read from this JSON. Python compilers + sync scripts read the same file.
// Adding a write surface = one entry there; nothing here should hand-list tool
// names.
const SURFACE_JSON_PATH = path.join(__dirname, 'write-tool-surface.json');
const WRITE_TOOL_SURFACE = JSON.parse(fs.readFileSync(SURFACE_JSON_PATH, 'utf-8'));

const BUILTIN_WRITE_TOOLS = new Set(WRITE_TOOL_SURFACE.builtin);
const MCP_WRITE_SPECS = new Map(WRITE_TOOL_SURFACE.mcp.map((spec) => [spec.name, spec]));
const MCP_WRITE_TOOLS = new Set(MCP_WRITE_SPECS.keys());
const MCP_WRITE_TOOL_MATCHER = [...MCP_WRITE_TOOLS].join('|');

function readStdinSync() {
  try {
    return fs.readFileSync(0, 'utf-8');
  } catch {
    return '';
  }
}

function parseHookInput() {
  const raw = readStdinSync();
  if (!raw) return null;
  try {
    const payload = JSON.parse(raw);
    const rawToolName = payload.tool_name || payload.tool || '';
    const rawToolInput = payload.tool_input || {};
    const normalized = normalizeWriteInput(rawToolName, rawToolInput);
    const toolName = normalized ? normalized.toolName : rawToolName;
    const toolInput = normalized ? normalized.toolInput : rawToolInput;
    const filePath = toolInput.file_path || toolInput.path || toolInput.relative_path || '';
    return { toolName, toolInput, filePath, payload, rawToolName, rawToolInput };
  } catch {
    return null;
  }
}

function isEditOrWrite(toolName) {
  if (!toolName) return false;
  return BUILTIN_WRITE_TOOLS.has(toolName) || MCP_WRITE_TOOLS.has(toolName);
}

function normalizeMcpWriteInput(spec, toolInput) {
  const filePath = toolInput[spec.path_field] || '';
  if (spec.kind === 'Write') {
    return { toolName: 'Write', toolInput: { file_path: filePath, content: toolInput[spec.content_field] || '' } };
  }
  if (spec.kind === 'Edit') {
    return {
      toolName: 'Edit',
      toolInput: { file_path: filePath, new_string: toolInput[spec.new_string_field] || '', old_string: '' },
    };
  }
  if (spec.kind === 'MultiEdit') {
    const sourceEdits = toolInput[spec.edits_field] || [];
    const edits = sourceEdits.map((edit) => ({
      old_string: edit[spec.edit_old_field] || '',
      new_string: edit[spec.edit_new_field] || '',
    }));
    return { toolName: 'MultiEdit', toolInput: { file_path: filePath, edits } };
  }
  return null;
}

function normalizeWriteInput(toolName, toolInput) {
  if (BUILTIN_WRITE_TOOLS.has(toolName)) {
    return { toolName, toolInput };
  }
  const spec = MCP_WRITE_SPECS.get(toolName);
  if (!spec) return null;
  return normalizeMcpWriteInput(spec, toolInput);
}

function extractContent(toolName, toolInput) {
  const normalized = normalizeWriteInput(toolName, toolInput);
  if (!normalized) return '';
  const { toolName: kind, toolInput: input } = normalized;
  if (kind === 'Write') return input.content || '';
  if (kind === 'Edit') return input.new_string || '';
  if (kind === 'MultiEdit') {
    const edits = input.edits || [];
    return edits.map((e) => e.new_string || '').join('\n');
  }
  return '';
}

module.exports = {
  parseHookInput,
  isEditOrWrite,
  extractContent,
  normalizeWriteInput,
  WRITE_TOOL_SURFACE,
  BUILTIN_WRITE_TOOLS,
  MCP_WRITE_TOOLS,
  MCP_WRITE_SPECS,
  MCP_WRITE_TOOL_MATCHER,
};
