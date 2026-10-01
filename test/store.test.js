'use strict';
/* Node behaviour when the selected context store is (not) configured in settings.js */
const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const { createRegisters, createServer } = require('./mock-server');

function fakeRED(contextStorage) {
	const types = {};
	const nodes = {};
	const RED = {
		settings: { contextStorage },
		nodes: {
			createNode(n, cfg) {
				EventEmitter.call(n);
				Object.assign(n, EventEmitter.prototype);
				const ctx = {};
				Object.assign(n, {
					id: cfg.id, sent: [], statuses: [], warnings: [],
					send: (m) => n.sent.push(m),
					status: (s) => n.statuses.push(s),
					warn: (w) => n.warnings.push(w),
					error: () => {},
					log: () => {},
					debug: () => {},
					context: () => ({ get: (k) => ctx[k], set: (k, v) => { ctx[k] = v; } })
				});
				nodes[cfg.id] = n;
			},
			registerType(name, ctor) { types[name] = ctor; },
			getNode(id) { return nodes[id]; }
		},
		util: { cloneMessage: (m) => JSON.parse(JSON.stringify(m)) }
	};
	require('../alphaess-modbus.js')(RED);
	return types;
}

function input(node, msg) {
	return new Promise((resolve) => {
		const out = [];
		node.emit('input', msg, (m) => out.push(m), (err) => resolve({ out, err }));
	});
}
const close = (node) => new Promise((r) => node.emit('close', r));

async function run(t, contextStorage, contextStore) {
	const server = createServer(createRegisters());
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	const types = fakeRED(contextStorage);
	const cfg = new types['alphaess-modbus-config']({ id: 'c', host: '127.0.0.1', port: server.address().port, delay: 0 });
	const n = new types['alphaess-modbus']({ id: 'n', server: 'c', interval: 0, contextStore,
		block_grid: true, block_battery: true, block_inverter: true });
	t.after(async () => { await close(n); await close(cfg); server.close(); });
	const initial = n.statuses[0];
	const r = await input(n, {});
	return { n, initial, data: r.out[0][0], alarm: r.out[0][1] };
}

test('missing store: warning at start, yellow status, warning in payload and alarm output', async (t) => {
	const { n, initial, data, alarm } = await run(t, undefined, 'file');
	assert.strictEqual(n.warnings.length, 1);
	assert.match(n.warnings[0], /context store "file" is not configured/);
	assert.strictEqual(initial.fill, 'yellow');
	const status = n.statuses[n.statuses.length - 1];
	assert.strictEqual(status.fill, 'yellow');
	assert.match(status.text, /store "file" missing/);
	assert.ok(data.payload.warnings.some((w) => /not persistent/.test(w)));
	assert.ok(alarm.payload.warnings.some((w) => /not persistent/.test(w)));
	assert.strictEqual(alarm.payload.active, false, 'a warning, not an alarm');
	assert.strictEqual(data.payload.daily.complete, false);
});

test('configured store: no warning', async (t) => {
	const { n, initial, data } = await run(t, { default: { module: 'memory' }, file: { module: 'localfilesystem' } }, 'file');
	assert.deepStrictEqual(n.warnings, []);
	assert.strictEqual(initial.fill, 'grey');
	assert.strictEqual(n.statuses[n.statuses.length - 1].fill, 'green');
	assert.ok(!data.payload.warnings.some((w) => /not persistent/.test(w)));
});

test('default store: no warning', async (t) => {
	const { n } = await run(t, undefined, '');
	assert.deepStrictEqual(n.warnings, []);
});
