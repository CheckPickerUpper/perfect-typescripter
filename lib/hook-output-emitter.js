'use strict';

function deny(reason) {
  process.stderr.write(String(reason));
  process.exit(2);
}

function adviseWithEvent(eventName, context) {
  const payload = {
    hookSpecificOutput: {
      hookEventName: String(eventName),
      additionalContext: String(context),
    },
  };
  process.stdout.write(JSON.stringify(payload));
  process.exit(0);
}

function advise(context) {
  adviseWithEvent('PreToolUse', context);
}

function adviseAfter(context) {
  adviseWithEvent('PostToolUse', context);
}

function adviseOnStart(context) {
  adviseWithEvent('SessionStart', context);
}

function adviseOnPromptSubmit(context) {
  adviseWithEvent('UserPromptSubmit', context);
}

function notify(message) {
  process.stdout.write(JSON.stringify({ systemMessage: String(message) }));
  process.exit(0);
}

function pass() {
  process.stdout.write('{}');
  process.exit(0);
}

module.exports = {
  deny,
  advise,
  adviseAfter,
  adviseOnStart,
  adviseOnPromptSubmit,
  adviseWithEvent,
  notify,
  pass,
};
