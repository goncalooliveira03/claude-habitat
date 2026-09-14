// User settings for the plugin, stored in <data>/config.json.
const fs = require('fs');
const { configFile, readJson, writeJsonAtomic, appendLog } = require('./io');

const DEFAULT_CONFIG = Object.freeze({
  mascot: 'cat',
  info: Object.freeze({ state: true, model: true, cost: true }),
  previousStatusLine: null,
});

function normalizeConfig(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const info = src.info && typeof src.info === 'object' ? src.info : {};
  const flag = (key) => (typeof info[key] === 'boolean' ? info[key] : DEFAULT_CONFIG.info[key]);
  return {
    // The name becomes a folder under mascots/, so only lowercase letters, digits and dashes.
    mascot: typeof src.mascot === 'string' && /^[a-z0-9-]+$/.test(src.mascot) ? src.mascot : DEFAULT_CONFIG.mascot,
    info: { state: flag('state'), model: flag('model'), cost: flag('cost') },
    previousStatusLine: src.previousStatusLine && typeof src.previousStatusLine === 'object' ? src.previousStatusLine : null,
  };
}

function loadConfig() {
  const raw = readJson(configFile(), undefined);
  if (raw === undefined && fs.existsSync(configFile())) {
    appendLog('render-error.log', 'config.json is not valid JSON; using defaults');
  }
  return normalizeConfig(raw);
}

const saveConfig = (config) => writeJsonAtomic(configFile(), normalizeConfig(config));

module.exports = { DEFAULT_CONFIG, normalizeConfig, loadConfig, saveConfig };
