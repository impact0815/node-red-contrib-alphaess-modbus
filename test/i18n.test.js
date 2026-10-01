'use strict';
/* Consistency of the language files: same keys and placeholders in all languages, every used key exists, help complete. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { createTranslator, lookup } = require('../lib/i18n');

const ROOT = path.join(__dirname, '..');
const LANGS = ['en-US', 'de'];
const catalog = (lang) => JSON.parse(fs.readFileSync(path.join(ROOT, 'locales', lang, 'alphaess-modbus.json'), 'utf8'));

function flatten(obj, prefix, out) {
	out = out || {};
	Object.keys(obj).forEach((k) => {
		const key = prefix ? `${prefix}.${k}` : k;
		if (obj[k] && typeof obj[k] === 'object') flatten(obj[k], key, out);
		else out[key] = obj[k];
	});
	return out;
}
const placeholders = (s) => (String(s).match(/__\w+__/g) || []).sort();

test('all languages have the same keys and placeholders', () => {
	const en = flatten(catalog('en-US'));
	LANGS.slice(1).forEach((lang) => {
		const other = flatten(catalog(lang));
		assert.deepStrictEqual(Object.keys(other).sort(), Object.keys(en).sort(), `keys of ${lang}`);
		Object.keys(en).forEach((k) => {
			assert.ok(String(other[k]).trim(), `${lang}: ${k} is empty`);
			assert.deepStrictEqual(placeholders(other[k]), placeholders(en[k]), `${lang}: placeholders of ${k}`);
		});
	});
});

test('every key used in the runtime exists', () => {
	const src = fs.readFileSync(path.join(ROOT, 'alphaess-modbus.js'), 'utf8');
	const keys = [...src.matchAll(/\bt\('([\w.-]+)'/g)].map((m) => m[1]);
	assert.ok(keys.length > 15, 'keys found');
	LANGS.forEach((lang) => {
		const c = catalog(lang);
		keys.forEach((k) => assert.strictEqual(typeof lookup(c, k), 'string', `${lang}: ${k}`));
	});
});

test('every key used in the editor exists', () => {
	const html = fs.readFileSync(path.join(ROOT, 'alphaess-modbus.html'), 'utf8');
	const keys = new Set();
	for (const m of html.matchAll(/data-i18n="([^"]+)"/g)) {
		m[1].split(';').forEach((part) => keys.add(part.replace(/^\[\w+\]/, '').trim()));
	}
	for (const m of html.matchAll(/_\('(alphaess-modbus\.[\w.]+)'/g)) if (!m[1].endsWith('.')) keys.add(m[1]); // composed keys are added below
	['data', 'alarm', 'response'].forEach((k) => keys.add(`alphaess-modbus.outputs.${k}`));
	const own = [...keys].filter((k) => !k.startsWith('node-red:'));
	assert.ok(own.length > 40, 'keys found');
	LANGS.forEach((lang) => {
		const c = catalog(lang);
		own.forEach((k) => assert.strictEqual(typeof lookup(c, k), 'string', `${lang}: ${k}`));
	});
	assert.ok(!/data-help-name/.test(html), 'help texts live in locales/, not in the main HTML file');
});

test('help files exist for all languages and contain both nodes and the disclaimer', () => {
	LANGS.forEach((lang) => {
		const help = fs.readFileSync(path.join(ROOT, 'locales', lang, 'alphaess-modbus.html'), 'utf8');
		assert.match(help, /data-help-name="alphaess-modbus-config"/, lang);
		assert.match(help, /data-help-name="alphaess-modbus"/, lang);
		assert.match(help, lang === 'de' ? /Haftungsausschluss/ : /Disclaimer/, `${lang}: disclaimer`);
		const opened = (help.match(/<script /g) || []).length;
		const closed = (help.match(/<\/script>/g) || []).length;
		assert.strictEqual(opened, closed, `${lang}: script tags`);
	});
});

test('translator: RED._, missing keys and fallback', () => {
	const fallback = createTranslator(undefined);
	assert.strictEqual(fallback('alphaess-modbus.status.polling', { interval: 15 }), 'polling every 15 s');
	assert.strictEqual(fallback('alphaess-modbus.does.not.exist'), 'alphaess-modbus.does.not.exist');

	const missing = createTranslator({ _: (k) => k });
	assert.strictEqual(missing('alphaess-modbus.status.manual'), 'manual mode', 'falls back to English if RED._ has no entry');

	const namespaced = createTranslator({ _: (k) => `@impact0815/node-red-contrib-alphaess-modbus/alphaess-modbus:${k}` });
	assert.strictEqual(namespaced('alphaess-modbus.status.manual'), 'manual mode', 'namespaced key counts as missing');

	const german = createTranslator({ _: (k, v) => (k === 'alphaess-modbus.status.polling' ? `Abfrage alle ${v.interval} s` : k) });
	assert.strictEqual(german('alphaess-modbus.status.polling', { interval: 5 }), 'Abfrage alle 5 s');

	const broken = createTranslator({ _: () => { throw new Error('i18n not ready'); } });
	assert.strictEqual(broken('alphaess-modbus.status.manual'), 'manual mode');
});
