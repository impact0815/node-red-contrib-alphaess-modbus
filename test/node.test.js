'use strict';
/* Integration tests: loads the Node-RED nodes with a minimal RED stub and talks to the simulator. */
const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const { createRegisters, createServer } = require('./mock-server');

function fakeRED() {
	const types = {};
	const nodes = {};
	const RED = {
		nodes: {
			createNode(n, cfg) {
				EventEmitter.call(n);
				Object.assign(n, EventEmitter.prototype);
				const ctx = {};
				Object.assign(n, {
					id: cfg.id, sent: [], statuses: [], warnings: [], errors: [],
					send: (m) => n.sent.push(m),
					status: (s) => n.statuses.push(s),
					warn: (w) => n.warnings.push(w),
					error: (e) => n.errors.push(e),
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
	return { RED, types, nodes };
}

function fakeBroker(nodes, id) {
	const b = { id, users: {}, published: [], deregistered: false };
	b.register = (u) => { b.users[u.id] = u; };
	b.deregister = (u, done) => { delete b.users[u.id]; b.deregistered = true; done(); };
	b.publish = (m) => b.published.push(m);
	nodes[id] = b;
	return b;
}

function input(node, msg) {
	return new Promise((resolve) => {
		const out = [];
		node.emit('input', msg, (m) => out.push(m), (err) => resolve({ out, err }));
	});
}
const close = (node) => new Promise((r) => node.emit('close', r));
const listen = (server) => new Promise((r) => server.listen(0, () => r(server.address().port)));

const ALL = {
	block_grid: true, block_battery: true, block_inverter: true, block_systemRun: true,
	block_systemConfig: true, block_timePeriod: true, block_dispatch: true, block_info: true
};

test('read cycle, slow blocks, alarm output, MQTT', async () => {
	const requests = [];
	const opts = { onRequest: (r) => requests.push(r) };
	const regs = createRegisters();
	const server = createServer(regs, opts);
	const port = await listen(server);
	const { RED, types, nodes } = fakeRED();
	require('../alphaess-modbus.js')(RED);
	const broker = fakeBroker(nodes, 'mq');
	const cfg = new types['alphaess-modbus-config']({ id: 'c1', host: '127.0.0.1', port, timeout: 1000, delay: 0 });
	const n = new types['alphaess-modbus'](Object.assign({
		id: 'n1', server: 'c1', interval: 0, slowInterval: 300, staleAfter: 1, mqttBroker: 'mq', mqttPrefix: 'pv/'
	}, ALL));
	assert.ok(broker.users['n1:mqtt'], 'registered at broker');

	// 1st cycle
	let r = await input(n, {});
	assert.ifError(r.err);
	let [data, alarm] = r.out[0];
	const p = data.payload;
	assert.strictEqual(p.consumption, 980);
	assert.strictEqual(p.soc, 87.3);
	assert.strictEqual(p.autarky, 100);
	assert.strictEqual(p.daily.pv, 0);
	assert.strictEqual(p.info.inverterInfo.serialNumber, 'AL5002021030123');
	assert.strictEqual(p.details.systemConfig.maxFeedIntoGridPercent, 70);
	assert.deepStrictEqual(p.alarms, []);
	assert.strictEqual(alarm.payload.active, false);
	assert.deepStrictEqual(alarm.payload.warnings, ['Battery: Temperature imbalance', 'Battery: Cell over voltage']);
	assert.ok(requests.every((q) => q.unit === 85));

	const topics = broker.published.map((m) => m.topic);
	['pv/consumption', 'pv/soc', 'pv/autarky', 'pv/daily/pv', 'pv/status', 'pv/alarm', 'pv/info'].forEach((t) => assert.ok(topics.includes(t), t));
	assert.ok(!topics.some((t) => t.startsWith('pv/details/')), 'details off by default');
	assert.strictEqual(broker.published.find((m) => m.topic === 'pv/consumption').payload, '980');
	assert.strictEqual(broker.published.find((m) => m.topic === 'pv/info').retain, true);

	// manual read forces slow blocks
	requests.length = 0;
	broker.published.length = 0;
	n.emit('input', { topic: 'read' }, () => {}, () => {});
	await new Promise((res) => setTimeout(res, 300));
	assert.ok(requests.some((q) => q.addr === 0x0800), 'manual read forces slow blocks');

	// inverter fails -> after staleAfter an alarm is raised once
	opts.failAddress = 0x0400;
	await new Promise((res) => setTimeout(res, 1100));
	r = await input(n, {});
	[data, alarm] = r.out[0];
	assert.match(data.errors.inverter, /exception 2/);
	assert.strictEqual(data.payload.blocks.inverter.stale, true);
	assert.strictEqual(data.payload.details.inverter, undefined);
	assert.strictEqual(data.payload.consumption, undefined);
	assert.ok(alarm.payload.alarms[0].startsWith('Stale data: inverter'));
	assert.ok(broker.published.some((m) => m.topic === 'pv/status' && m.payload === 'alarm'));
	r = await input(n, {});
	assert.strictEqual(r.out[0][1], null, 'no alarm message without change');

	// recovery
	delete opts.failAddress;
	r = await input(n, {});
	assert.strictEqual(r.out[0][1].payload.active, false);
	assert.strictEqual(r.out[0][0].payload.consumption, 980);

	await close(n);
	assert.ok(broker.deregistered);
	await close(cfg);
	server.close();
});

test('write protection and write commands', async () => {
	const server = createServer(createRegisters());
	const port = await listen(server);
	const { RED, types } = fakeRED();
	require('../alphaess-modbus.js')(RED);
	const cfg = new types['alphaess-modbus-config']({ id: 'c', host: '127.0.0.1', port, delay: 0 });
	const ro = new types['alphaess-modbus']({ id: 'ro', server: 'c', interval: 0, block_battery: true });
	const rw = new types['alphaess-modbus']({ id: 'rw', server: 'c', interval: 0, allowWrite: true, maxPower: 5000 });

	let r = await input(ro, { topic: 'dispatch', payload: { power: -2000 } });
	assert.match(String(r.err), /Writing is disabled/);

	r = await input(rw, { topic: 'dispatch', payload: { power: -3000, soc: 90, duration: 600 } });
	assert.ifError(r.err);
	assert.deepStrictEqual(r.out[0][0].payload, {
		active: true, activePower: -3000, reactivePower: 0,
		mode: { raw: 2, text: 'State of Charge control' }, soc: 90, time: 600
	});
	r = await input(rw, { topic: 'dispatch', payload: { power: 8000 } });
	assert.match(String(r.err), /power must be between/);
	r = await input(rw, { topic: 'dispatchStop' });
	assert.strictEqual(r.out[0][0].payload.active, false);
	r = await input(rw, { topic: 'feedIn', payload: 50 });
	assert.strictEqual(r.out[0][0].payload.maxFeedIntoGridPercent, 50);
	r = await input(rw, { topic: 'timePeriod', payload: { flag: 1, charge1: { start: '02:00', stop: '04:30' } } });
	assert.strictEqual(r.out[0][0].payload.flag.text, 'Charge enabled');
	assert.deepStrictEqual(r.out[0][0].payload.charge1, { start: '02:00', stop: '04:30' });
	r = await input(rw, { topic: 'readRaw', payload: { address: 0x0102, count: 1 } });
	assert.deepStrictEqual(r.out[0][0].payload, [873]);
	r = await input(rw, { topic: 'unknown' });
	assert.match(String(r.err), /Unknown topic/);

	for (const x of [ro, rw, cfg]) await close(x);
	server.close();
});

test('unreachable host and polling mode', async () => {
	const { RED, types } = fakeRED();
	require('../alphaess-modbus.js')(RED);
	const bad = new types['alphaess-modbus-config']({ id: 'bad', host: '127.0.0.1', port: 1, timeout: 500 });
	const n = new types['alphaess-modbus']({ id: 'x', server: 'bad', interval: 0, block_grid: true });
	const r = await input(n, {});
	assert.ok(r.out[0][0].errors.grid);
	assert.strictEqual(n.statuses.slice(-1)[0].fill, 'red');
	await close(n); await close(bad);

	const requests = [];
	const server = createServer(createRegisters(), { onRequest: (q) => requests.push(q) });
	const port = await listen(server);
	const cfg = new types['alphaess-modbus-config']({ id: 'p', host: '127.0.0.1', port, delay: 0 });
	const poller = new types['alphaess-modbus']({ id: 'poll', server: 'p', interval: 1, slowInterval: 300,
		block_battery: true, block_systemConfig: true });
	await new Promise((res) => setTimeout(res, 2300));
	assert.ok(poller.sent.length >= 2, `sent ${poller.sent.length}`);
	assert.strictEqual(requests.filter((q) => q.addr === 0x0800).length, 1, 'slow block read only once');
	assert.strictEqual(requests.filter((q) => q.addr === 0x0100).length, poller.sent.length);
	assert.strictEqual(poller.sent[1][0].payload.details.systemConfig.maxFeedIntoGridPercent, 70, 'slow block cached');
	assert.strictEqual(poller.sent[0][0].payload.soc, 87.3);
	await close(poller); await close(cfg);
	server.close();
});
