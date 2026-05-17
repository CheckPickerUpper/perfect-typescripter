'use strict';

const fs = require('fs');
const path = require('path');

function loadConfigWalkup(startDir, configRelPath, defaults = {}) {
  let dir = startDir ? path.resolve(startDir) : process.cwd();
  const root = path.parse(dir).root || '/';
  while (dir && dir !== root && dir !== '.' && dir !== path.dirname(dir)) {
    const configPath = path.join(dir, configRelPath);
    if (fs.existsSync(configPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        return { ...defaults, ...raw, __path: configPath, __root: dir };
      } catch {
        return { ...defaults, __path: configPath, __root: dir, __malformed: true };
      }
    }
    dir = path.dirname(dir);
  }
  return { ...defaults };
}

function findConfigWalkup(startDir, configRelPath) {
  let dir = startDir ? path.resolve(startDir) : process.cwd();
  const root = path.parse(dir).root || '/';
  while (dir && dir !== root && dir !== '.' && dir !== path.dirname(dir)) {
    const configPath = path.join(dir, configRelPath);
    if (fs.existsSync(configPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        return { path: configPath, root: dir, raw };
      } catch {
        return { path: configPath, root: dir, raw: null, malformed: true };
      }
    }
    dir = path.dirname(dir);
  }
  return null;
}

function loadConfigAt(configPath, defaults = {}) {
  if (!fs.existsSync(configPath)) return { ...defaults };
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return { ...defaults, ...raw };
  } catch {
    return { ...defaults, __malformed: true };
  }
}

function loadConfigAtOrNull(configPath, { pluginTag } = {}) {
  if (!fs.existsSync(configPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch (e) {
    if (pluginTag) {
      process.stderr.write(`[${pluginTag}] Malformed config at ${configPath}: ${e.message}. Falling back.\n`);
    }
    return null;
  }
}

module.exports = { loadConfigWalkup, loadConfigAt, findConfigWalkup, loadConfigAtOrNull };
