'use strict';

/**
 * why-tag-grammar.js
 *
 * Canonical implementation of the @why-tag grammar defined in
 * plugins/why-tag/skills/why-tag-rules/SKILL.md. Per-language guards
 * (perfect-rustacean/hooks/why_tag_guard.js,
 * perfect-typescripter/hooks/why_tag_guard.js) keep their
 * language-specific comment parser and function-declaration regex,
 * but route the grammar decisions (vocabulary, reason validation,
 * compacting, denial message format) through this single module.
 *
 * Before this lib existed, both guards independently re-implemented the
 * same vocabulary, weasel blocklist, length minimum, connector regexes,
 * and denial-message template. They stayed in sync by hand. Drift was a
 * latent bug class — any improvement to the grammar had to be applied in
 * two places, or the two enforcers would silently disagree on what a
 * valid @why is. This module ends that class: there is one grammar.
 *
 * @why this lives in hook-lib, not in either per-language guard.
 *      The why-tag SKILL.md is the canonical spec. A language guard
 *      vendoring the spec is fine, but two guards independently
 *      vendoring the spec is exactly the duplication class hook-lib
 *      exists to remove. Edit this file in hook-lib/lib/, then run
 *      `python lab-tools/vendor-hook-lib.py` to propagate to consumers
 *      (perfect-rustacean, perfect-typescripter).
 */

// ── CANONICAL GRAMMAR CONSTANTS — MUST MATCH why-tag-rules/SKILL.md ──────

/**
 * @why Preserves the "≥ 20 characters after trimming" rule from
 *      SKILL.md so reasons too short to carry a useful purpose
 *      statement are rejected uniformly across every language guard.
 *      Edits here must mirror SKILL.md or the spec and the enforcers
 *      will drift.
 */
const MIN_WHY_LENGTH = 20;

/**
 * @why Preserves the relative path to the canonical spec so denial
 *      messages can point readers at the source of truth without each
 *      caller hard-coding the path. Centralising the string here is
 *      the single edit point if the spec ever moves.
 */
const WHY_TAG_RULE_REFERENCE = 'plugins/why-tag/skills/why-tag-rules/SKILL.md';

/**
 * @why Preserves the weasel blocklist verbatim from SKILL.md so a
 *      reason matching any of these substrings is rejected before it
 *      can launder a non-purpose vibe into a passing tag. Editing this
 *      list without editing SKILL.md is a bug; the spec is authority.
 */
const WEASEL_BLOCKLIST = Object.freeze([
	'just in case',
	'for safety',
	'to be safe',
	'be safe',
	'idk',
	'fixme',
	'todo',
	'wip',
	'placeholder',
	'hack',
	'temporary',
	'later',
	'will fix',
	'good practice',
	'best practice',
	'defensive',
	'paranoid',
	"can't hurt",
	"doesn't hurt",
	'might as well',
	'why not',
]);

/**
 * @why Preserves the purpose-connector vocabulary that distinguishes a
 *      WHY tag from a WHAT-only restatement. Per SKILL.md a valid
 *      reason MUST contain an explicit purpose connector
 *      (`so callers can`, `because`, `prevents`, `preserves`,
 *      `without`, `rather than`, `instead of`, ...) so the sentence
 *      goes past the obvious action and names a caller-facing
 *      invariant, failure mode, or purpose. The `so` form has lookahead
 *      assertions that require both a consumer noun (callers,
 *      consumers, downstream, ...) and an action verb (can, cannot,
 *      assume, prevent, ...) inside 120 chars so weak padding such as
 *      "so it can be returned" stays invalid.
 */
const WHY_PURPOSE_CONNECTORS = Object.freeze([
	/\bso(?:\s+that)?\b(?=.{0,120}\b(?:callers|consumers|clients|downstream|upstream|agents?|handlers?|modules?|crates?|components?|users?|tests?|ui|workflow)\b)(?=.{0,120}\b(?:can|cannot|avoid|prevent|assume|reuse|join|switch|derive|preserve|maintain|must|never|do\s+not|does\s+not)\b)/i,
	/\bbecause\b/i,
	/\bprevents?\b/i,
	/\bavoids?\b/i,
	/\bpreserves?\b/i,
	/\bensures?\b/i,
	/\bguarantees?\b/i,
	/\bwithout\b/i,
	/\brather than\b/i,
	/\binstead of\b/i,
	/\ballows?\s+(?:callers|consumers|clients|downstream|upstream|agents?|handlers?|modules?|crates?|components?)\s+to\b/i,
	/\benables?\s+(?:callers|consumers|clients|downstream|upstream|agents?|handlers?|modules?|crates?|components?)\s+to\b/i,
	/\bexists\s+so\b/i,
]);

// ── REASON PREDICATES ────────────────────────────────────────────────────

/**
 * @why Preserves the case-insensitive substring match defined in
 *      SKILL.md so callers can ask "is this reason weaseling?" without
 *      re-deriving the lowering and iteration each time. Returns the
 *      matched phrase (truthy) or null so the caller can put the
 *      exact phrase into a deny message without re-scanning.
 */
function reasonIsWeasel(reason) {
	const lower = String(reason || '').toLowerCase();
	for (const phrase of WEASEL_BLOCKLIST) {
		if (lower.includes(phrase)) return phrase;
	}
	return null;
}

/**
 * @why Preserves the "must contain a purpose connector" rule from
 *      SKILL.md so callers can ask "does this reason go past WHAT into
 *      WHY?" without re-implementing the connector regex list. Returns
 *      a boolean rather than the matched pattern because no caller
 *      currently needs to know which connector matched.
 */
function reasonHasPurposeConnector(reason) {
	const text = String(reason || '');
	return WHY_PURPOSE_CONNECTORS.some((pattern) => pattern.test(text));
}

/**
 * @why Preserves the boolean predicate "is this string a valid @why
 *      reason?" so callers that only want a yes/no answer (tests, ad-hoc
 *      scripts, scope explorers) can avoid threading the structured
 *      error result. Returns true only when length, weasel, and
 *      connector checks all pass — the same five-condition gate the
 *      per-language guards use, minus the binding-membership condition
 *      that is language-specific.
 */
function isValidWhyReason(reason) {
	const text = String(reason || '').trim();
	if (text.length < MIN_WHY_LENGTH) return false;
	if (reasonIsWeasel(text) !== null) return false;
	if (!reasonHasPurposeConnector(text)) return false;
	return true;
}

/**
 * @why Preserves the structured validation result that the per-language
 *      guards need: either `{ reason, binding }` on success or
 *      `{ error }` with a human-readable message that names which
 *      rule fired (length / weasel / connector) and references the
 *      binding label the caller passed in. Centralising the message
 *      template here so both Rust and TS denial output uses the same
 *      wording was a stated goal of this extraction.
 */
function validateReason(reason, bindingName) {
	const text = String(reason || '');
	if (!text || text.length < MIN_WHY_LENGTH) {
		return {
			error:
				`@why reason too short in binding ${bindingName} — got ${text.length} chars, need ≥ ${MIN_WHY_LENGTH}. ` +
				`Reason: "${text}"`,
		};
	}
	const weasel = reasonIsWeasel(text);
	if (weasel) {
		return {
			error:
				`@why reason contains weasel phrase "${weasel}" in binding ${bindingName}. ` +
				`See ${WHY_TAG_RULE_REFERENCE} for the full blocklist.`,
		};
	}
	if (!reasonHasPurposeConnector(text)) {
		return {
			error:
				`@why reason restates WHAT without explaining WHY in binding ${bindingName}. ` +
				`Use a purpose connector such as "so callers can", "because", "prevents", "preserves", "without", or "instead of". ` +
				`Reason: "${text}"`,
		};
	}
	return { reason: text, binding: bindingName };
}

// ── COMPACTING + DENIAL MESSAGE ─────────────────────────────────────────

const MISSING_WHY_PREFIX = 'no @why tag found';

/**
 * @why Preserves the "missing tag vs invalid tag" classification used
 *      by the denial-message formatter so the two failure modes can be
 *      grouped under separate headings ("Missing @why:" vs "Invalid
 *      @why:"). Centralising the prefix string here keeps the
 *      classification stable even if the binding wording changes.
 */
function isMissingWhyTag(reason) {
	return String(reason || '').startsWith(MISSING_WHY_PREFIX);
}

/**
 * @why Preserves the compact display form used by the denial-message
 *      formatter so a long invalid-reason error gets collapsed to a
 *      single line (whitespace runs flattened) and a missing-tag error
 *      becomes the literal "missing @why tag" string. The compacted
 *      reason is what callers paste into per-failure list lines so
 *      repeated multi-line errors do not blow up the message.
 */
function compactWhyReason(reason) {
	if (isMissingWhyTag(reason)) return 'missing @why tag';
	return String(reason || '').replace(/\s+/g, ' ').trim();
}

/**
 * @why Preserves the per-site sentence shape used in denial messages
 *      so each failure is rendered as "line N: <signature> -- <reason>"
 *      regardless of language. The signature comes from the site's
 *      snippet (the source line trimmed and whitespace-normalised) and
 *      is sliced to 140 chars so a multi-line function header does not
 *      overrun the deny message.
 */
function formatSiteSignature(site) {
	return String((site && site.snippet) || '').replace(/\s+/g, ' ').trim().slice(0, 140);
}

/**
 * @why Preserves the "missing group + invalid group" layout from
 *      perfect-rustacean's denial format so consumers can build a
 *      grouped failure list without re-implementing the heading +
 *      per-line shape. Mutates the `lines` array in place (matches the
 *      original pushWhyTagFailureGroup signature) and adds a trailing
 *      blank line so the next section starts on its own line.
 */
function pushWhyFailureGroup(lines, title, failures) {
	if (!Array.isArray(failures) || failures.length === 0) return;
	lines.push(title);
	for (const failure of failures) {
		lines.push(
			`- line ${failure.site.line + 1}: ${formatSiteSignature(failure.site)} -- ${compactWhyReason(failure.reason)}`,
		);
	}
	lines.push('');
}

/**
 * @why Preserves the canonical denial-message template from
 *      perfect-rustacean's formatWhyTagDenial so every language guard
 *      emits an identical structure: header line naming the plugin tag
 *      and the failure count, file path, fix instruction, accepted
 *      bindings, then grouped Missing / Invalid sections, then a
 *      pointer to SKILL.md and an example. The caller passes a per-
 *      language `options` bag (pluginTag, siteNoun, exampleLines,
 *      bindingsLine) so this shared formatter can be neutral about
 *      whether the language is Rust or TS while keeping the layout
 *      byte-identical.
 */
function formatMissingWhyDenial(filePath, failures, options) {
	const opts = options || {};
	const pluginTag = opts.pluginTag || 'why-tag';
	const siteNoun = opts.siteNoun || 'function';
	const bindingsLine =
		opts.bindingsLine ||
		'Accepted bindings: preceding doc block, trailing same-line comment, or preceding line comment within 3 lines.';
	const fixLine =
		opts.fixLine ||
		`Fix: add an adjacent \`@why <one sentence reason>\` to each listed ${siteNoun}.`;
	const exampleLines = Array.isArray(opts.exampleLines) && opts.exampleLines.length > 0
		? opts.exampleLines
		: [
			'  // @why Computes a stable cache key so callers in other packages can memo without re-deriving tenant rules.',
			'  export function cacheKeyFor(user) { ... }',
		];

	const suffix = failures.length === 1 ? '' : 's';
	const missingFailures = failures.filter((failure) => isMissingWhyTag(failure.reason));
	const invalidFailures = failures.filter((failure) => !isMissingWhyTag(failure.reason));

	const lines = [
		`[${pluginTag}] @why TAG REQUIRED - blocked ${failures.length} ${siteNoun}${suffix}.`,
		`File: ${filePath}`,
		fixLine,
		bindingsLine,
		'',
	];

	pushWhyFailureGroup(lines, 'Missing @why:', missingFailures);
	pushWhyFailureGroup(lines, 'Invalid @why:', invalidFailures);

	lines.push(`Full grammar/weasel list: ${WHY_TAG_RULE_REFERENCE}`);
	lines.push('Example:');
	for (const line of exampleLines) lines.push(line);

	return lines.join('\n');
}

module.exports = {
	MIN_WHY_LENGTH,
	WHY_TAG_RULE_REFERENCE,
	WEASEL_BLOCKLIST,
	WHY_PURPOSE_CONNECTORS,
	MISSING_WHY_PREFIX,
	reasonIsWeasel,
	reasonHasPurposeConnector,
	isValidWhyReason,
	validateReason,
	isMissingWhyTag,
	compactWhyReason,
	formatSiteSignature,
	pushWhyFailureGroup,
	formatMissingWhyDenial,
};
