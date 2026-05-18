'use strict';

const fs = require('fs');
const pathModule = require('path');

// Translates an OpenCode `tool.execute.before` payload into the JSON shape a
// Claude PreToolUse hook reads off stdin: `{ tool_name, tool_input, cwd }`.
//
// Each OpenCode tool gets its own translator. A translator is
// `(opencodeArgs, cwd) => ClaudePayload[]` — zero or more Claude payloads,
// because some OpenCode tools fan out (apply_patch covers N files) and some
// produce nothing scannable (delete-only patches).
//
// Unknown OpenCode tools yield `{ kind: 'unsupported' }` so the bundle skips
// the hook spawn instead of feeding hooks a fabricated empty payload.

// Canonical write-tool surface, vendored next to this file by the compiler.
// Used to auto-build a translator for every MCP write tool name so the registry
// never needs hand-maintained MCP entries.
const WRITE_TOOL_SURFACE = JSON.parse(fs.readFileSync(pathModule.join(__dirname, 'write-tool-surface.json'), 'utf-8'));
const APPLY_PATCH_TEXT_FIELDS = ['patchText', 'patch', 'command'];

function stringField(candidate) {
  return typeof candidate === 'string' ? candidate : '';
}

function plainObject(candidate) {
  return (typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate)) ? candidate : {};
}

function patchTextFromApplyPatchArgs(opencodeApplyPatchArgs) {
  if (typeof opencodeApplyPatchArgs === 'string') return opencodeApplyPatchArgs;
  const applyPatchArgs = plainObject(opencodeApplyPatchArgs);
  for (const fieldName of APPLY_PATCH_TEXT_FIELDS) {
    const fieldValue = applyPatchArgs[fieldName];
    if (typeof fieldValue === 'string') return fieldValue;
  }
  return '';
}

function buildClaudeWriteToolInput(filePath, fileContent) {
  return {
    file_path: filePath,
    content: fileContent,
  };
}

function writePayload(opencodeWriteArgs, cwd) {
  const writeArgs = plainObject(opencodeWriteArgs);
  return [{
    tool_name: 'Write',
    tool_input: buildClaudeWriteToolInput(stringField(writeArgs.filePath), stringField(writeArgs.content)),
    cwd: stringField(cwd),
  }];
}

function editPayload(opencodeEditArgs, cwd) {
  const editArgs = plainObject(opencodeEditArgs);
  return [{
    tool_name: 'Edit',
    tool_input: {
      file_path: stringField(editArgs.filePath),
      old_string: stringField(editArgs.oldString),
      new_string: stringField(editArgs.newString),
    },
    cwd: stringField(cwd),
  }];
}

function bashPayload(opencodeBashArgs, cwd) {
  const bashArgs = plainObject(opencodeBashArgs);
  return [{
    tool_name: 'Bash',
    tool_input: {
      command: stringField(bashArgs.command),
      description: stringField(bashArgs.description),
    },
    cwd: stringField(cwd),
  }];
}

// Parses the OpenAI/Codex apply_patch format (`*** Begin Patch` ... `*** End Patch`)
// into per-file Claude payloads:
//   - Add File    -> Write   { file_path, content }
//   - Update File -> MultiEdit { file_path, edits: [{old_string, new_string}] }
//   - Delete File -> skip (no new content to scan)
//   - Move-only Update with no content change -> skip
// On a malformed/missing-marker patch, returns []. The apply_patch tool itself
// will error downstream and surface that to the user; we don't double-report.
function applyPatchPayloads(opencodeApplyPatchArgs, cwd) {
  const patchText = patchTextFromApplyPatchArgs(opencodeApplyPatchArgs);
  if (patchText.length === 0) return [];
  const hunks = parsePatchHunks(patchText);
  const cwdField = stringField(cwd);
  const claudePayloads = [];
  for (const hunk of hunks) {
    const claudePayload = hunkToClaudePayload(hunk, cwdField);
    if (claudePayload !== null) claudePayloads.push(claudePayload);
  }
  return claudePayloads;
}

function hunkToClaudePayload(hunk, cwdField) {
  if (hunk.kind === 'add') {
    return {
      tool_name: 'Write',
      tool_input: buildClaudeWriteToolInput(hunk.filePath, hunk.fileContent),
      cwd: cwdField,
    };
  }
  if (hunk.kind === 'update') {
    const filePath = typeof hunk.movePath === 'string' && hunk.movePath.length > 0 ? hunk.movePath : hunk.filePath;
    const edits = hunk.chunks.map(updateChunkToEdit).filter((edit) => edit !== null);
    if (edits.length === 0) return null;
    return {
      tool_name: 'MultiEdit',
      tool_input: { file_path: filePath, edits },
      cwd: cwdField,
    };
  }
  return null;
}

function updateChunkToEdit(updateChunk) {
  const oldString = updateChunk.oldLines.join('\n');
  const newString = updateChunk.newLines.join('\n');
  if (oldString === newString) return null;
  return { old_string: oldString, new_string: newString };
}

const PATCH_BEGIN_MARKER = '*** Begin Patch';
const PATCH_END_MARKER = '*** End Patch';
const ADD_FILE_PREFIX = '*** Add File:';
const DELETE_FILE_PREFIX = '*** Delete File:';
const UPDATE_FILE_PREFIX = '*** Update File:';
const MOVE_TO_PREFIX = '*** Move to:';
const END_OF_FILE_MARKER = '*** End of File';

function parsePatchHunks(patchText) {
  const bodyRange = locatePatchBody(patchText);
  if (bodyRange === null) return [];
  return collectHunksInRange(bodyRange.lines, bodyRange.bodyStart, bodyRange.bodyEnd);
}

function locatePatchBody(patchText) {
  const lines = patchText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const beginIdx = lines.findIndex((line) => line.trim() === PATCH_BEGIN_MARKER);
  const endIdx = lines.findIndex((line) => line.trim() === PATCH_END_MARKER);
  if (beginIdx === -1 || endIdx === -1 || beginIdx >= endIdx) return null;
  return { lines, bodyStart: beginIdx + 1, bodyEnd: endIdx };
}

function collectHunksInRange(lines, bodyStart, bodyEnd) {
  const hunks = [];
  let lineIdx = bodyStart;
  while (lineIdx < bodyEnd) {
    const parsed = parseSingleHunk(lines, lineIdx, bodyEnd);
    if (parsed.hunk !== null) hunks.push(parsed.hunk);
    lineIdx = parsed.nextIdx;
  }
  return hunks;
}

function parseSingleHunk(lines, headerIdx, bodyEnd) {
  const headerLine = lines[headerIdx];
  if (headerLine.startsWith(ADD_FILE_PREFIX)) {
    return parseAddHunk(lines, headerIdx, bodyEnd);
  }
  if (headerLine.startsWith(DELETE_FILE_PREFIX)) {
    return parseDeleteHunk(headerLine, headerIdx);
  }
  if (headerLine.startsWith(UPDATE_FILE_PREFIX)) {
    return parseUpdateHunk(lines, headerIdx, bodyEnd);
  }
  return { hunk: null, nextIdx: headerIdx + 1 };
}

function parseAddHunk(lines, headerIdx, bodyEnd) {
  const filePath = lines[headerIdx].slice(ADD_FILE_PREFIX.length).trim();
  const addBody = parseAddFileBody(lines, headerIdx + 1, bodyEnd);
  if (filePath.length === 0) return { hunk: null, nextIdx: addBody.nextIdx };
  return {
    hunk: { kind: 'add', filePath, fileContent: addBody.fileContent },
    nextIdx: addBody.nextIdx,
  };
}

function parseDeleteHunk(headerLine, headerIdx) {
  const filePath = headerLine.slice(DELETE_FILE_PREFIX.length).trim();
  if (filePath.length === 0) return { hunk: null, nextIdx: headerIdx + 1 };
  return { hunk: { kind: 'delete', filePath }, nextIdx: headerIdx + 1 };
}

function parseUpdateHunk(lines, headerIdx, bodyEnd) {
  const filePath = lines[headerIdx].slice(UPDATE_FILE_PREFIX.length).trim();
  const moveDirective = parseOptionalMoveDirective(lines, headerIdx + 1, bodyEnd);
  const updateBody = parseUpdateFileChunks(lines, moveDirective.nextIdx, bodyEnd);
  if (filePath.length === 0) return { hunk: null, nextIdx: updateBody.nextIdx };
  return {
    hunk: { kind: 'update', filePath, movePath: moveDirective.movePath, chunks: updateBody.chunks },
    nextIdx: updateBody.nextIdx,
  };
}

function parseOptionalMoveDirective(lines, lineIdx, bodyEnd) {
  if (lineIdx < bodyEnd && lines[lineIdx].startsWith(MOVE_TO_PREFIX)) {
    return { movePath: lines[lineIdx].slice(MOVE_TO_PREFIX.length).trim(), nextIdx: lineIdx + 1 };
  }
  return { movePath: undefined, nextIdx: lineIdx };
}

function parseAddFileBody(lines, startIdx, endIdx) {
  const contentLines = [];
  let lineIdx = startIdx;
  while (lineIdx < endIdx && !lines[lineIdx].startsWith('***')) {
    if (lines[lineIdx].startsWith('+')) {
      contentLines.push(lines[lineIdx].slice(1));
    }
    lineIdx += 1;
  }
  return { fileContent: contentLines.join('\n'), nextIdx: lineIdx };
}

function parseUpdateFileChunks(lines, startIdx, endIdx) {
  const chunks = [];
  let lineIdx = startIdx;
  while (lineIdx < endIdx && !lines[lineIdx].startsWith('***')) {
    if (!lines[lineIdx].startsWith('@@')) {
      lineIdx += 1;
      continue;
    }
    const updateChunk = parseSingleUpdateChunk(lines, lineIdx + 1, endIdx);
    chunks.push({ oldLines: updateChunk.oldLines, newLines: updateChunk.newLines });
    lineIdx = updateChunk.nextIdx;
  }
  return { chunks, nextIdx: lineIdx };
}

function parseSingleUpdateChunk(lines, startIdx, endIdx) {
  const oldLines = [];
  const newLines = [];
  let lineIdx = startIdx;
  while (lineIdx < endIdx && !lines[lineIdx].startsWith('@@') && !lines[lineIdx].startsWith('***')) {
    const changeLine = lines[lineIdx];
    if (changeLine === END_OF_FILE_MARKER) {
      lineIdx += 1;
      break;
    }
    classifyChangeLine(changeLine, oldLines, newLines);
    lineIdx += 1;
  }
  return { oldLines, newLines, nextIdx: lineIdx };
}

function classifyChangeLine(changeLine, oldLines, newLines) {
  if (changeLine.startsWith(' ')) {
    const lineContent = changeLine.slice(1);
    oldLines.push(lineContent);
    newLines.push(lineContent);
    return;
  }
  if (changeLine.startsWith('-')) {
    oldLines.push(changeLine.slice(1));
    return;
  }
  if (changeLine.startsWith('+')) {
    newLines.push(changeLine.slice(1));
  }
}

function buildMcpWritePayload(mcpSpec, opencodeArgs, cwd) {
  const mcpArgs = plainObject(opencodeArgs);
  const filePath = stringField(mcpArgs[mcpSpec.path_field]);
  const cwdField = stringField(cwd);
  if (mcpSpec.kind === 'Write') {
    const fileContent = stringField(mcpArgs[mcpSpec.content_field]);
    return [{
      tool_name: 'Write',
      tool_input: buildClaudeWriteToolInput(filePath, fileContent),
      cwd: cwdField,
    }];
  }
  if (mcpSpec.kind === 'Edit') {
    return [{
      tool_name: 'Edit',
      tool_input: {
        file_path: filePath,
        new_string: stringField(mcpArgs[mcpSpec.new_string_field]),
        old_string: '',
      },
      cwd: cwdField,
    }];
  }
  if (mcpSpec.kind === 'MultiEdit') {
    const sourceEdits = Array.isArray(mcpArgs[mcpSpec.edits_field]) ? mcpArgs[mcpSpec.edits_field] : [];
    const edits = sourceEdits.map((sourceEdit) => {
      const editObject = plainObject(sourceEdit);
      return {
        old_string: stringField(editObject[mcpSpec.edit_old_field]),
        new_string: stringField(editObject[mcpSpec.edit_new_field]),
      };
    });
    return [{
      tool_name: 'MultiEdit',
      tool_input: { file_path: filePath, edits },
      cwd: cwdField,
    }];
  }
  return [];
}

const OPENCODE_TOOL_TRANSLATORS = {
  write: writePayload,
  edit: editPayload,
  bash: bashPayload,
  apply_patch: applyPatchPayloads,
};

// Auto-register every canonical MCP write tool. The MCP-side payload field
// names live in the JSON, so adding a new MCP write surface = one JSON entry,
// and this registry picks it up at runtime without any code change here.
for (const mcpSpec of WRITE_TOOL_SURFACE.mcp) {
  OPENCODE_TOOL_TRANSLATORS[mcpSpec.name] = (opencodeArgs, cwd) =>
    buildMcpWritePayload(mcpSpec, opencodeArgs, cwd);
}

function buildClaudePayloads({ opencodeToolName, opencodeArgs, cwd }) {
  const translator = OPENCODE_TOOL_TRANSLATORS[opencodeToolName];
  if (typeof translator !== 'function') return { kind: 'unsupported' };
  return { kind: 'built', payloads: translator(opencodeArgs, cwd) };
}

function matcherAcceptsClaudeToolName(matcher, claudeToolName) {
  if (typeof matcher !== 'string' || matcher.length === 0) { return true; }
  try {
    const re = new RegExp(`^(?:${matcher})$`);
    return re.test(claudeToolName);
  } catch (regexCompileFailure) {
    return false;
  }
}

module.exports = {
  OPENCODE_TOOL_TRANSLATORS,
  buildClaudePayloads,
  matcherAcceptsClaudeToolName,
  parsePatchHunks,
};
