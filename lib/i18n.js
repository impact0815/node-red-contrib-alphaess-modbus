'use strict';
/**
 * Runtime translations.
 *
 * In Node-RED, RED._() looks up the message catalogs in locales/<language>/alphaess-modbus.json
 * (language of the Node-RED server). If RED._ is not available (tests, older runtimes) or the key
 * is missing, the English catalog is used directly. The English catalog is therefore the single
 * source of truth for all runtime texts.
 *
 * Placeholders use the Node-RED syntax __name__.
 */
const fs = require('fs');
const path = require('path');

const FALLBACK_FILE = path.join(__dirname, '..', 'locales', 'en-US', 'alphaess-modbus.json');
let fallbackCatalog = null;

function loadFallback() {
	if (!fallbackCatalog) {
		try {
			fallbackCatalog = JSON.parse(fs.readFileSync(FALLBACK_FILE, 'utf8'));
		} catch (err) {
			fallbackCatalog = {};
		}
	}
	return fallbackCatalog;
}

/** "a.b.c" -> catalog.a.b.c */
function lookup(catalog, key) {
	return key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), catalog);
}

function interpolate(text, vars) {
	return String(text).replace(/__(\w+)__/g, (m, k) => (vars && vars[k] !== undefined ? String(vars[k]) : m));
}

/**
 * @param {object} RED  Node-RED runtime API (RED._ is pre-scoped to this module)
 * @returns {function(string, object=): string}
 */
function createTranslator(RED) {
	return function t(key, vars) {
		if (RED && typeof RED._ === 'function') {
			try {
				const s = RED._(key, vars);
				if (typeof s === 'string' && s && s !== key && !s.endsWith(':' + key)) return s;
			} catch (err) {
				// fall through to the English catalog
			}
		}
		const text = lookup(loadFallback(), key);
		return typeof text === 'string' ? interpolate(text, vars) : key;
	};
}

module.exports = { createTranslator, interpolate, lookup, FALLBACK_FILE };
