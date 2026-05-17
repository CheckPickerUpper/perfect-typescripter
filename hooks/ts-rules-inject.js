#!/usr/bin/env node
'use strict';

/**
 * SessionStart hook for perfect-typescripter.
 *
 * Emits a short headline summary of the enforced TypeScript rules into
 * SessionStart additionalContext, so the AI starts every session with the
 * rule shape already loaded instead of rediscovering it the third time the
 * PreToolUse gate denies a write.
 *
 * The full rulebook lives in skill perfect-typescripter:typescript-rules
 * and auto-loads on first .ts/.tsx touch. This hook covers cold start,
 * resume, and post-compaction reinjection.
 */

const fs = require('fs');
const path = require('path');

const SUMMARY = `perfect-typescripter active. Full body: invoke skill perfect-typescripter:typescript-rules.
PreToolUse blocks TS footguns: nullable/optional state, any/unknown, boolean domain fields, enums, unsafe casts/assertions/coercions, optional/nullish operators, 2+ positional params, degenerate comparators, product switch matrices, and missing @why tags.
Correct shape: discriminated unions, named param objects, constructors/type guards, explicit variants, and documented exported APIs. Known exemptions stay in the full skill/config.`;

function readPayload() {
	try {
		return JSON.parse(fs.readFileSync(0, 'utf8'));
	} catch {
		// Falling back to process.cwd() lets the detection probe run when
		// SessionStart is invoked without stdin (manual test, edge host).
		return {};
	}
}

function findTsConfig(startDir) {
	let dir = path.resolve(startDir);
	for (let i = 0; i < 20; i += 1) {
		if (fs.existsSync(path.join(dir, 'tsconfig.json'))) return dir;
		const parent = path.dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
	return null;
}

function projectUsesTypescript(projectRoot) {
	if (findTsConfig(projectRoot)) return true;
	const configPath = path.join(projectRoot, '.claude', 'ai-lab', 'perfect-typescripter', 'config.json');
	if (fs.existsSync(configPath)) return true;
	return false;
}

function main() {
	const payload = readPayload();
	const projectRoot = payload.cwd || process.cwd();
	if (!projectUsesTypescript(projectRoot)) return;
	process.stdout.write(SUMMARY + '\n');
}

try {
	main();
	process.exit(0);
} catch (err) {
	process.stderr.write(`ts-rules-inject: ${err && err.stack || err}\n`);
	process.exit(0);
}
