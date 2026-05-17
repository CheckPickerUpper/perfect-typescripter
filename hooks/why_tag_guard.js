#!/usr/bin/env node
'use strict';
/**
 * @why Preserves the "every exported function carries a one-sentence
 * reason-for-existing" invariant from plugins/why-tag/skills/why-tag-rules/SKILL.md.
 * Without this hook the invariant holds only as documentation, which
 * means past-Claude's exported helpers ship with no rationale and
 * callers in other packages have to open the body to learn what the
 * function is for.
 *
 * Runs as PreToolUse on Write|Edit|MultiEdit, filters to TS/JS file
 * extensions, scans the new content for exported function declarations,
 * and denies the write unless every site has a valid @why tag
 * (length + weasel + binding).
 *
 * Earlier versions of this hook also flagged `as any` / `as unknown`,
 * ts-directive comments, and eval as required @why sites. The spec
 * dropped those: those constructs are banned outright by other
 * enforcers and @why is not a bypass-pass. A guard that let a bypass
 * through because someone wrote a paragraph next to it turned @why
 * into a launderer; that path is closed.
 *
 * Grammar constants, the reason predicate, the compactor, and the
 * denial-message template all come from
 * plugins/hook-lib/lib/why-tag-grammar.js (vendored into ./lib/). The
 * comment parser (JSDoc) and the export-function detector stay here
 * because they are TS/JS-specific.
 */

const fs = require('fs');
const path = require('path');

const {
	validateReason,
	formatMissingWhyDenial,
} = require('../lib/why-tag-grammar.js');

const SUPPORTED_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

// ── IO ──────────────────────────────────────────────────────────────────

/**
 * @why Preserves the "never block on malformed hook input" contract from
 * the hooks-reference doc: if the payload is unreadable we cannot make a
 * correctness claim about the file, so we return an empty payload and
 * let the write through rather than denying on absence of evidence.
 */
function readPayload() {
	try {
		return JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
	} catch {
		return {};
	}
}

/**
 * @why Preserves the deny-message protocol from hooks-reference: deny
 * outputs the JSON envelope on stdout and terminates with status 0 so
 * Claude Code reads the structured decision rather than treating a
 * non-zero exit as a hook failure (which would let the write through).
 */
function deny(reason) {
	const out = {
		hookSpecificOutput: {
			hookEventName: 'PreToolUse',
			permissionDecision: 'deny',
			permissionDecisionReason: reason,
		},
	};
	process.stdout.write(JSON.stringify(out));
	process.exit(0);
}

function getContent(toolName, input) {
	if (toolName === 'Write') return String(input.content || '');
	if (toolName === 'Edit') return String(input.new_string || '');
	if (toolName === 'MultiEdit') {
		const edits = Array.isArray(input.edits) ? input.edits : [];
		return edits.map((e) => String(e.new_string || '')).join('\n');
	}
	return '';
}

// ── COMMENT PARSER (JSDoc-SPECIFIC) ─────────────────────────────────────

function readJSDocAtClose(lines, closeIdx, bindingLabel) {
	let openIdx = -1;
	for (let i = closeIdx; i >= 0; i--) {
		if (/\/\*\*/.test(lines[i])) {
			openIdx = i;
			break;
		}
	}
	if (openIdx === -1) return null;
	const block = lines.slice(openIdx, closeIdx + 1).join('\n');
	const whyMatch = block.match(/@why\b\s*([^\n*]*(?:\n\s*\*\s*[^\n*@]*)*)/);
	if (!whyMatch) return null;
	const reason = whyMatch[1]
		.split('\n')
		.map((l) => l.replace(/^\s*\*\s?/, '').trim())
		.join(' ')
		.trim();
	return validateReason(reason, bindingLabel);
}

function findBoundWhy(lines, siteLineIdx) {
	const siteLine = lines[siteLineIdx] || '';
	const trailing = siteLine.match(/\/\/\s*@why\b\s*(.*)$/);
	if (trailing) {
		return validateReason(trailing[1].trim(), 'B (trailing same-line)');
	}

	for (let offset = 1; offset <= 3; offset++) {
		const idx = siteLineIdx - offset;
		if (idx < 0) break;
		const line = lines[idx].trim();
		if (line === '') break;
		const lineWhy = line.match(/^\/\/\s*@why\b\s*(.*)$/);
		if (lineWhy) {
			return validateReason(lineWhy[1].trim(), 'C (preceding line comment)');
		}
		if (!line.startsWith('//') && !line.startsWith('*') && !line.startsWith('/*')) {
			break;
		}
	}

	let closeIdx = -1;
	for (let offset = 1; offset <= 3; offset++) {
		const idx = siteLineIdx - offset;
		if (idx < 0) break;
		if (/\*\//.test(lines[idx])) {
			closeIdx = idx;
			break;
		}
		if (lines[idx].trim() !== '' && !lines[idx].trim().startsWith('*')) break;
	}
	if (closeIdx !== -1) {
		const result = readJSDocAtClose(lines, closeIdx, 'A (preceding JSDoc block)');
		if (result) return result;
	}

	return { error: 'no @why tag found in bindings A (preceding JSDoc), B (trailing same-line), or C (preceding line comment)' };
}

// ── SITE DETECTION (TS/JS-SPECIFIC) ─────────────────────────────────────

const EXPORT_FN_PATTERNS = [
	/^\s*export\s+(?:async\s+)?function\b/,
	/^\s*export\s+default\s+(?:async\s+)?function\b/,
	/^\s*export\s+(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*(?::\s*[^=]+)?=\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/,
	/^\s*export\s+(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*(?::\s*[^=]+)?=\s*(?:async\s+)?function\b/,
];

/**
 * @why Preserves the "scan only real source, never match inside
 * comments or string literals" contract. The earlier hook scanned raw
 * lines, which produced false positives on doc-comment examples that
 * quoted the very patterns the rule targets. This stripper is stateful
 * across lines to handle multi-line block comments and JSDoc; it takes
 * a mutable state object to carry the in-block-comment flag between
 * calls.
 */
function stripCommentsAndStrings(line, state) {
	let out = '';
	let i = 0;
	let inString = null;
	while (i < line.length) {
		const ch = line[i];
		const next = line[i + 1];
		if (state.inBlockComment) {
			if (ch === '*' && next === '/') {
				state.inBlockComment = false;
				i += 2;
				continue;
			}
			i += 1;
			continue;
		}
		if (inString) {
			if (ch === '\\') {
				i += 2;
				continue;
			}
			if (ch === inString) {
				inString = null;
				i += 1;
				continue;
			}
			i += 1;
			continue;
		}
		if (ch === '/' && next === '/') break;
		if (ch === '/' && next === '*') {
			state.inBlockComment = true;
			i += 2;
			continue;
		}
		if (ch === '"' || ch === "'" || ch === '`') {
			inString = ch;
			i += 1;
			continue;
		}
		out += ch;
		i += 1;
	}
	return out;
}

function detectSites(content) {
	const lines = content.split(/\r?\n/);
	const sites = [];
	const state = { inBlockComment: false };

	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i];
		const code = stripCommentsAndStrings(raw, state);

		for (const pattern of EXPORT_FN_PATTERNS) {
			if (pattern.test(code)) {
				sites.push({ line: i, kind: 'exported function', snippet: raw.trim() });
				break;
			}
		}
	}

	return sites;
}

// ── MAIN ────────────────────────────────────────────────────────────────

/**
 * @why Preserves the early-exit contract from the hooks-reference doc:
 * any branch where the file is irrelevant (wrong tool, wrong extension,
 * test file, no content, no sites, all sites valid) MUST exit silent so
 * Claude Code lets the write through. A non-silent exit on an irrelevant
 * file would block legitimate writes.
 */
function main() {
	const payload = readPayload();
	const toolName = payload.tool_name || '';
	const input = payload.tool_input || {};

	if (toolName !== 'Write' && toolName !== 'Edit' && toolName !== 'MultiEdit') process.exit(0);

	const filePath = input.file_path || '';
	if (!filePath) process.exit(0);

	const ext = path.extname(filePath).toLowerCase();
	if (!SUPPORTED_EXTS.has(ext)) process.exit(0);

	if (/\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/.test(filePath)) process.exit(0);

	const content = getContent(toolName, input);
	if (!content) process.exit(0);

	const sites = detectSites(content);
	if (sites.length === 0) process.exit(0);

	const lines = content.split(/\r?\n/);
	const failures = [];

	for (const site of sites) {
		const check = findBoundWhy(lines, site.line);
		if (check.error) {
			failures.push({ site, reason: check.error });
		}
	}

	if (failures.length === 0) process.exit(0);

	const lang = ext === '.ts' || ext === '.tsx' ? 'TypeScript' : 'JavaScript';
	deny(formatMissingWhyDenial(filePath, failures, {
		pluginTag: 'perfect-typescripter',
		siteNoun: `${lang} exported function`,
		fixLine: 'Fix: add an adjacent `@why <one sentence reason>` to each listed exported function (JSDoc, trailing `// @why`, or preceding `// @why` within 3 lines).',
		bindingsLine: 'Accepted bindings: preceding JSDoc block, trailing same-line comment, or preceding line comment within 3 lines.',
		exampleLines: [
			'  /**',
			'   * @why Computes a stable cache key from user tenant and role so callers in other packages can memo without re-deriving tenant rules.',
			'   */',
			'  export function cacheKeyFor(user) { ... }',
		],
	}));
}

main();
