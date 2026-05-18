'use strict';

const fs = require('fs');
const pathModule = require('path');

const WINDOWS_DRIVE_PATH_PATTERN = /^[A-Za-z]:[\\/]/;
const WSL_UNC_PATH_PATTERN = /^[/\\]{2}wsl(?:\.localhost)?[/\\][^/\\]+[/\\](.+)$/i;

// Single source of truth for every MCP write tool name + its path-field name. Loaded from
// the JSON the compiler vendors next to this file. The Claude-side canonical hook handles
// payload-shape normalization via parseHookInput; the runtime mapper only needs to know
// which tool names to pass through and which payload field carries the file path so the
// extension filter can decide whether to scan.
const WRITE_TOOL_SURFACE = JSON.parse(fs.readFileSync(pathModule.join(__dirname, 'write-tool-surface.json'), 'utf-8'));
const MCP_WRITE_PATH_FIELDS = new Map(WRITE_TOOL_SURFACE.mcp.map((spec) => [spec.name, spec.path_field]));
const BUILTIN_WRITE_TOOL_NAMES = new Set(WRITE_TOOL_SURFACE.builtin);
const APPLY_PATCH_TOOL_NAMES = new Set(['apply_patch', 'functions.apply_patch']);
const APPLY_PATCH_TEXT_FIELDS = ['command', 'patch', 'patchText'];

const CHECKED_EXTENSIONS = new Set([
  '.adoc',
  '.css',
  '.dart',
  '.htm',
  '.html',
  '.cjs',
  '.js',
  '.jsx',
  '.less',
  '.lua',
  '.luau',
  '.md',
  '.mdx',
  '.mjs',
  '.py',
  '.rst',
  '.sass',
  '.scss',
  '.json',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.vue',
  '.svelte',
  '.rs',
  '.sql',
]);

function readHookPayload() {
  try {
    const rawPayload = fs.readFileSync(0, 'utf8');
    return rawPayload.trim() ? JSON.parse(rawPayload) : {};
  } catch {
    return {};
  }
}

function repositoryRoot(hookPayload) {
  return hostPathFromCodexPath(hookPayload.cwd || process.cwd());
}

function normalizePathSeparators(filePathText) {
  return String(filePathText || '').replace(/\\/g, '/');
}

function hostPathFromCodexPath(filePathText) {
  const rawFilePathText = String(filePathText || '');
  const wslUncMatch = rawFilePathText.match(WSL_UNC_PATH_PATTERN);
  if (wslUncMatch) return `/${normalizePathSeparators(wslUncMatch[1])}`;

  const normalizedFilePathText = normalizePathSeparators(rawFilePathText);
  const drivePathMatch = normalizedFilePathText.match(/^([A-Za-z]):\/(.*)$/);
  if (drivePathMatch && process.platform !== 'win32') {
    return `/mnt/${drivePathMatch[1].toLowerCase()}/${drivePathMatch[2]}`;
  }
  return normalizedFilePathText;
}

function absoluteFilePath(projectRoot, filePathText) {
  const hostFilePathText = hostPathFromCodexPath(filePathText);
  if (pathModule.isAbsolute(hostFilePathText) || WINDOWS_DRIVE_PATH_PATTERN.test(String(filePathText))) {
    return hostFilePathText;
  }
  return pathModule.join(projectRoot, hostFilePathText);
}

function hasCheckedExtension(filePathText) {
  return CHECKED_EXTENSIONS.has(pathModule.extname(normalizePathSeparators(filePathText)).toLowerCase());
}

function plainObject(candidate) {
  return (typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate)) ? candidate : {};
}

function canonicalToolName(toolName) {
  const rawToolName = String(toolName || '');
  return APPLY_PATCH_TOOL_NAMES.has(rawToolName) ? 'apply_patch' : rawToolName;
}

function patchTextFromApplyPatchInput(toolInput) {
  if (typeof toolInput === 'string') return toolInput;
  const toolInputObject = plainObject(toolInput);
  for (const fieldName of APPLY_PATCH_TEXT_FIELDS) {
    const fieldValue = toolInputObject[fieldName];
    if (typeof fieldValue === 'string') return fieldValue;
  }
  return '';
}

function decodePatchLine(patchLine) {
  return patchLine.slice(1);
}

function applyHunk(currentFileLines, oldHunkLines, newHunkLines) {
  if (oldHunkLines.length === 0) {
    currentFileLines.push(...newHunkLines);
    return currentFileLines;
  }
  for (let lineIndex = 0; lineIndex <= currentFileLines.length - oldHunkLines.length; lineIndex++) {
    let hunkMatches = true;
    for (let hunkIndex = 0; hunkIndex < oldHunkLines.length; hunkIndex++) {
      if (currentFileLines[lineIndex + hunkIndex] !== oldHunkLines[hunkIndex]) {
        hunkMatches = false;
        break;
      }
    }
    if (hunkMatches) {
      return [
        ...currentFileLines.slice(0, lineIndex),
        ...newHunkLines,
        ...currentFileLines.slice(lineIndex + oldHunkLines.length),
      ];
    }
  }
  throw new Error('Patch hunk did not match current file contents.');
}

function isPatchFileHeader(patchLine) {
  return patchLine.startsWith('*** Add File: ')
    || patchLine.startsWith('*** Update File: ')
    || patchLine.startsWith('*** Delete File: ');
}

function advanceToNextPatchFileHeader(patchLines, patchLineIndex) {
  while (patchLineIndex < patchLines.length && !isPatchFileHeader(patchLines[patchLineIndex])) {
    patchLineIndex++;
  }
  return patchLineIndex;
}

function parsePatchDocument(patchText, projectRoot) {
  const patchLines = patchText.split(/\r?\n/);
  const changedFiles = [];
  let patchLineIndex = 0;

  while (patchLineIndex < patchLines.length) {
    const patchLine = patchLines[patchLineIndex];

    if (patchLine.startsWith('*** Add File: ')) {
      const filePathText = normalizePathSeparators(patchLine.slice('*** Add File: '.length));
      patchLineIndex++;
      if (!hasCheckedExtension(filePathText)) {
        patchLineIndex = advanceToNextPatchFileHeader(patchLines, patchLineIndex);
        continue;
      }

      const addedLines = [];
      while (patchLineIndex < patchLines.length && !patchLines[patchLineIndex].startsWith('*** ')) {
        const contentLine = patchLines[patchLineIndex];
        if (contentLine.startsWith('+')) addedLines.push(decodePatchLine(contentLine));
        patchLineIndex++;
      }
      changedFiles.push({ filePathText, finalContent: addedLines.join('\n') + '\n' });
      continue;
    }

    if (patchLine.startsWith('*** Update File: ')) {
      const originalFilePathText = normalizePathSeparators(patchLine.slice('*** Update File: '.length));
      let finalFilePathText = originalFilePathText;
      patchLineIndex++;

      while (patchLineIndex < patchLines.length && patchLines[patchLineIndex].startsWith('*** Move to: ')) {
        finalFilePathText = normalizePathSeparators(patchLines[patchLineIndex].slice('*** Move to: '.length));
        patchLineIndex++;
      }

      if (!hasCheckedExtension(originalFilePathText) && !hasCheckedExtension(finalFilePathText)) {
        patchLineIndex = advanceToNextPatchFileHeader(patchLines, patchLineIndex);
        continue;
      }

      const absoluteOriginalPath = absoluteFilePath(projectRoot, originalFilePathText);
      let currentFileLines = fs.readFileSync(absoluteOriginalPath, 'utf8').split('\n');

      while (patchLineIndex < patchLines.length) {
        const updateLine = patchLines[patchLineIndex];
        if (updateLine.startsWith('*** Move to: ')) {
          finalFilePathText = normalizePathSeparators(updateLine.slice('*** Move to: '.length));
          patchLineIndex++;
          continue;
        }
        if (updateLine === '@@' || updateLine.startsWith('@@ ')) {
          patchLineIndex++;
          const oldHunkLines = [];
          const newHunkLines = [];
          while (patchLineIndex < patchLines.length && !patchLines[patchLineIndex].startsWith('*** ') && !patchLines[patchLineIndex].startsWith('@@')) {
            const hunkLine = patchLines[patchLineIndex];
            if (hunkLine === '*** End of File') {
              patchLineIndex++;
              continue;
            }
            if (hunkLine.startsWith(' ')) {
              const contextLine = decodePatchLine(hunkLine);
              oldHunkLines.push(contextLine);
              newHunkLines.push(contextLine);
            } else if (hunkLine.startsWith('-')) {
              oldHunkLines.push(decodePatchLine(hunkLine));
            } else if (hunkLine.startsWith('+')) {
              newHunkLines.push(decodePatchLine(hunkLine));
            }
            patchLineIndex++;
          }
          currentFileLines = applyHunk(currentFileLines, oldHunkLines, newHunkLines);
          continue;
        }
        break;
      }

      changedFiles.push({ filePathText: finalFilePathText, finalContent: currentFileLines.join('\n') });
      continue;
    }

    if (patchLine.startsWith('*** Delete File: ')) {
      patchLineIndex++;
      continue;
    }

    patchLineIndex++;
  }

  return changedFiles.filter((changedFile) => hasCheckedExtension(changedFile.filePathText));
}

function payloadsForHook(hookPayload) {
  const toolName = canonicalToolName(hookPayload.tool_name);
  const toolPayload = plainObject(hookPayload.tool_input);
  const projectRoot = repositoryRoot(hookPayload);

  if (toolName === 'apply_patch') {
    const patchText = patchTextFromApplyPatchInput(hookPayload.tool_input);
    try {
      return parsePatchDocument(patchText, projectRoot).map((changedFile) => ({
        ...hookPayload,
        hook_event_name: 'PreToolUse',
        tool_name: 'Write',
        tool_input: {
          file_path: absoluteFilePath(projectRoot, changedFile.filePathText),
          content: changedFile.finalContent,
        },
      }));
    } catch {
      return [];
    }
  }

  if (BUILTIN_WRITE_TOOL_NAMES.has(toolName)) {
    const filePathText = String(toolPayload.file_path || '');
    if (!hasCheckedExtension(filePathText)) return [];
    return [hookPayload];
  }

  // MCP write tool: pass the payload through unchanged. The canonical hook's
  // parseHookInput normalizes the per-tool payload shape, so the runtime mapper
  // only filters by extension here using the tool-specific path field name.
  const mcpPathFieldName = MCP_WRITE_PATH_FIELDS.get(toolName);
  if (mcpPathFieldName !== undefined) {
    const filePathText = String(toolPayload[mcpPathFieldName] || '');
    if (!hasCheckedExtension(filePathText)) return [];
    return [hookPayload];
  }

  return [];
}

function matcherAcceptsClaudeToolName(matcher, claudeToolName) {
  if (matcher === null || matcher === undefined || matcher === '') { return true; }
  try {
    return new RegExp(`^(?:${matcher})$`).test(claudeToolName);
  } catch {
    return false;
  }
}

module.exports = {
  payloadsForHook,
  matcherAcceptsClaudeToolName,
  readHookPayload,
};
