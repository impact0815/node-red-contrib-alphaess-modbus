'use strict';
/* Integration tests: loads the Node-RED nodes with a minimal RED stub and talks to the simulator. */
const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const { createRegisters, createServer, NEW_RANGES } = require('./mock-server');

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
					id: cfg.id, sent: [], statuses: [], warnings: [], errors: [], logs: [],
					send: (m) => n.sent.push(m),
					status: (s) => n.statuses.push(s),
					warn: (w) => n.warnings.push(w),
					error: (e) => n.errors.push(e),
					log: (l) => n.logs.push(l),
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ALL = {
	block_grid: true, block_battery: true, block_inverter: true, block_systemRun: true,
	block_systemConfig: true, block_timePeriod: true, block_dispatch: true, block_info: true
};

test('read cycle, slow blocks, alarm output, MQTT', async () => {
	const requests = [];
	const opts = { onRequest: (r) => requests.push(r) };
	const server = createServer(createRegisters(), opts);
	const port = await listen(server);
	const { RED, types, nodes } = fakeRED();
	require('../alphaess-modbus.js')(RED);
	const broker = fakeBroker(nodes, 'mq');
	const cfg = new types['alphaess-modbus-config']({ id: 'c1', host: '127.0.0.1', port, timeout: 1000, delay: 0 });
	const n = new types['alphaess-modbus'](Object.assign({
		id: 'n1', server: 'c1', interval: 0, slowInterval: 300, staleAfter: 1, mqttBroker: 'mq', mqttPrefix: 'pv/'
	}, ALL));
	assert.ok(broker.users['n1:mqtt'], 'registered at broker');
	assert.deepStrictEqual(n.warnings, [], 'no store warning with default store');

	let r = await input(n, {});
	assert.ifError(r.err);
	assert.strictEqual(r.out[0].length, 3, 'three outputs');
	let [data, alarm, response] = r.out[0];
	assert.strictEqual(response, null, 'poll never uses output 3');
	const p = data.payload;
	assert.strictEqual(p.consumption, 980);
	assert.strictEqual(p.soc, 87.3);
	assert.strictEqual(p.autarky, 100);
	assert.strictEqual(p.daily.pv, 0);
	assert.strictEqual(typeof p.daily.complete, 'boolean');
	assert.strictEqual(p.info.inverterInfo.serialNumber, 'AL5002021030123');
	assert.deepStrictEqual(p.info.batteryInfo.serialNumbers, ['BAT0000001', 'BAT0000002', 'BAT0000003']);
	assert.strictEqual(p.info.systemInfo.wifiSerialNumber, 'WIFI12345678');
	assert.deepStrictEqual(p.details.grid.energyFeedToGridPhase, [410, 420, 404.56]);
	assert.strictEqual(p.details.inverter.pvPowerTotalRegister, 4000);
	assert.strictEqual(p.details.systemConfig.maxFeedIntoGridPercent, 70);
	assert.deepStrictEqual(p.alarms, []);
	assert.strictEqual(alarm.payload.active, false);
	assert.deepStrictEqual(alarm.payload.warnings, ['Battery: Temperature imbalance', 'Battery: Cell over voltage']);
	assert.ok(requests.every((q) => q.unit === 85));
	assert.ok(requests.some((q) => q.addr === 0x0010 && q.qty === 51), 'grid with 51 registers');
	assert.ok(requests.some((q) => q.addr === 0x0400 && q.qty === 85), 'inverter with 85 registers');

	const topics = broker.published.map((m) => m.topic);
	['pv/consumption', 'pv/soc', 'pv/autarky', 'pv/daily/pv', 'pv/daily/complete', 'pv/status', 'pv/alarm', 'pv/info']
		.forEach((t) => assert.ok(topics.includes(t), t));
	assert.ok(!topics.includes('pv/daily/since') && !topics.includes('pv/daily/day'));
	assert.ok(!topics.some((t) => t.startsWith('pv/details/')), 'details off by default');
	assert.strictEqual(broker.published.find((m) => m.topic === 'pv/consumption').payload, '980');
	assert.strictEqual(broker.published.find((m) => m.topic === 'pv/info').retain, true);

	// manual read forces slow blocks
	requests.length = 0;
	broker.published.length = 0;
	n.emit('input', { topic: 'read' }, () => {}, () => {});
	await sleep(300);
	assert.ok(requests.some((q) => q.addr === 0x0800), 'manual read forces slow blocks');

	// inverter fails completely -> after staleAfter an alarm is raised once
	opts.failAddress = 0x0400;
	await sleep(1100);
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

test('older firmware: automatic fallback to the register lengths of V1.1', async () => {
	const requests = [];
	const server = createServer(createRegisters(), { unsupported: NEW_RANGES, onRequest: (q) => requests.push(q) });
	const port = await listen(server);
	const { RED, types } = fakeRED();
	require('../alphaess-modbus.js')(RED);
	const cfg = new types['alphaess-modbus-config']({ id: 'c', host: '127.0.0.1', port, delay: 0 });
	const n = new types['alphaess-modbus'](Object.assign({ id: 'legacy', server: 'c', interval: 0 }, ALL));

	let r = await input(n, {});
	assert.ifError(r.err);
	const p = r.out[0][0].payload;
	assert.strictEqual(r.out[0][0].errors, undefined, 'no read errors after fallback');
	assert.deepStrictEqual(n.warnings, [], 'no warnings, only log entries');
	assert.strictEqual(p.consumption, 980);
	assert.strictEqual(p.details.grid.energyFeedToGridPhase, undefined);
	assert.strictEqual(p.details.inverter.pvPowerTotalRegister, undefined);
	assert.strictEqual(p.details.dispatch.pvSwitch, undefined);
	assert.strictEqual(p.blocks.grid.registers, 39);
	assert.strictEqual(p.blocks.inverter.registers, 83);
	assert.strictEqual(p.info.inverterInfo.serialNumber, 'AL5002021030123');
	assert.strictEqual(p.info.systemInfo.emsVersion.text, '2.5.18');
	assert.strictEqual(p.info.batteryInfo, undefined, 'battery serial numbers not supported');
	assert.ok(n.logs.some((l) => /grid: extended registers not supported/.test(l)));
	assert.ok(n.logs.some((l) => /batteryInfo: not supported/.test(l)));

	// the fallback is remembered: second cycle only uses the short requests
	requests.length = 0;
	r = await input(n, {});
	assert.ifError(r.err);
	assert.deepStrictEqual(requests.filter((q) => q.addr === 0x0010).map((q) => q.qty), [39]);
	assert.deepStrictEqual(requests.filter((q) => q.addr === 0x0400).map((q) => q.qty), [83]);

	// re-reading device info does not try the unsupported battery block again
	requests.length = 0;
	r = await input(n, { topic: 'readInfo' });
	assert.ifError(r.err);
	assert.ok(!requests.some((q) => q.addr === 0x0150));
	assert.strictEqual(r.out[0][2].errors, undefined);

	await close(n); await close(cfg);
	server.close();
});

test('write commands: output 3, unchanged detection, only changed registers, rate limit', async () => {
	const requests = [];
	const regs = createRegisters();
	const server = createServer(regs, { onRequest: (q) => requests.push(q) });
	const port = await listen(server);
	const { RED, types } = fakeRED();
	require('../alphaess-modbus.js')(RED);
	const cfg = new types['alphaess-modbus-config']({ id: 'c', host: '127.0.0.1', port, delay: 0 });
	const ro = new types['alphaess-modbus']({ id: 'ro', server: 'c', interval: 0, block_battery: true });
	const rw = new types['alphaess-modbus']({ id: 'rw', server: 'c', interval: 0, allowWrite: true, maxPower: 5000, writeInterval: 1 });
	const writes = () => requests.filter((q) => q.fc === 16).map((q) => [q.addr, q.qty]);
	const resp = (r) => { assert.ifError(r.err); assert.strictEqual(r.out[0][0], null); assert.strictEqual(r.out[0][1], null); return r.out[0][2]; };

	let r = await input(ro, { topic: 'dispatch', payload: { power: -2000 } });
	assert.match(String(r.err), /Writing is disabled/);
	r = await input(ro, { topic: 'timePeriod', payload: { upsReserveSoc: 10 } });
	assert.match(String(r.err), /Writing is disabled/);
	assert.deepStrictEqual(writes(), []);

	let m = resp(await input(rw, { topic: 'timePeriod', payload: { upsReserveSoc: 10, chargeCutSoc: 100 } }));
	assert.strictEqual(m.unchanged, true);
	assert.deepStrictEqual(m.written, []);
	assert.strictEqual(m.payload.upsReserveSoc, 10);
	assert.deepStrictEqual(writes(), []);

	m = resp(await input(rw, { topic: 'timePeriod', payload: { upsReserveSoc: 20, chargeCutSoc: 100 } }));
	assert.strictEqual(m.unchanged, false);
	assert.deepStrictEqual(m.written, [{ address: '0x0850', values: [200] }]);
	assert.deepStrictEqual(writes(), [[0x0850, 1]]);
	assert.strictEqual(m.payload.upsReserveSoc, 20);
	assert.strictEqual(regs[0x0855], 1000, 'other register untouched');

	m = resp(await input(rw, { topic: 'timePeriod', payload: { upsReserveSoc: 20 } }));
	assert.strictEqual(m.unchanged, true);
	r = await input(rw, { topic: 'timePeriod', payload: { upsReserveSoc: 30 } });
	assert.match(String(r.err), /write blocked, next write possible in 1 s/);
	assert.deepStrictEqual(writes(), [[0x0850, 1]]);
	await sleep(1050);

	requests.length = 0;
	m = resp(await input(rw, { topic: 'timePeriod', payload: { flag: 1, charge1: { start: '02:00', stop: '04:30' } } }));
	// start minute was already 00 -> only the stop minute is written
	assert.deepStrictEqual(writes(), [[0x084F, 1], [0x0856, 2], [0x085F, 1]]);
	assert.strictEqual(m.payload.flag.text, 'Charge enabled');
	assert.deepStrictEqual(m.payload.charge1, { start: '02:00', stop: '04:30' });

	requests.length = 0;
	m = resp(await input(rw, { topic: 'feedIn', payload: 70 }));
	assert.strictEqual(m.unchanged, true);
	m = resp(await input(rw, { topic: 'feedIn', payload: { percent: 50 } }));
	assert.strictEqual(m.payload.maxFeedIntoGridPercent, 50);
	assert.deepStrictEqual(writes(), [[0x0800, 1]]);
	r = await input(rw, { topic: 'feedIn', payload: 101 });
	assert.match(String(r.err), /percent must be between 0 and 100/);

	requests.length = 0;
	m = resp(await input(rw, { topic: 'dispatch', payload: { power: -3000, soc: 90, duration: 600 } }));
	assert.deepStrictEqual(m.payload, {
		active: true, activePower: -3000, reactivePower: 0,
		mode: { raw: 2, text: 'State of Charge control' }, soc: 90, time: 600,
		para7: 0, pvSwitch: { raw: 0, text: 'not set' }
	});
	assert.deepStrictEqual(m.written, [{ address: '0x0880', values: [1, 0, 29000, 0, 32000, 2, 225, 0, 600] }]);
	r = await input(rw, { topic: 'dispatch', payload: { power: -3000 } });
	assert.match(String(r.err), /dispatch: write blocked/);
	m = resp(await input(rw, { topic: 'dispatchStop' }));
	assert.strictEqual(m.payload.active, false);
	m = resp(await input(rw, { topic: 'dispatchStop' }));
	assert.strictEqual(m.payload.active, false, 'repeated stop is allowed');
	r = await input(rw, { topic: 'dispatch', payload: { power: 8000 } });
	assert.match(String(r.err), /power must be between/);
	r = await input(rw, { topic: 'dispatch', payload: { power: 0, mode: 20 } });
	assert.match(String(r.err), /mode must be one of/);

	m = resp(await input(rw, { topic: 'readRaw', payload: { address: 0x0102, count: 1 } }));
	assert.deepStrictEqual(m.payload, [873]);
	m = resp(await input(rw, { topic: 'readInfo' }));
	assert.strictEqual(m.payload.systemInfo.emsSerialNumber, 'AL9002012345678');
	r = await input(rw, { topic: 'unknown' });
	assert.match(String(r.err), /Unknown topic/);

	for (const x of [ro, rw, cfg]) await close(x);
	server.close();
});

test('rate limit can be disabled', async () => {
	const server = createServer(createRegisters());
	const port = await listen(server);
	const { RED, types } = fakeRED();
	require('../alphaess-modbus.js')(RED);
	const cfg = new types['alphaess-modbus-config']({ id: 'c', host: '127.0.0.1', port, delay: 0 });
	const rw = new types['alphaess-modbus']({ id: 'rw', server: 'c', interval: 0, allowWrite: true, writeInterval: 0 });
	for (const soc of [20, 30, 40]) {
		const r = await input(rw, { topic: 'timePeriod', payload: { upsReserveSoc: soc } });
		assert.ifError(r.err);
		assert.strictEqual(r.out[0][2].payload.upsReserveSoc, soc);
	}
	await close(rw); await close(cfg);
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
	await sleep(2300);
	assert.ok(poller.sent.length >= 2, `sent ${poller.sent.length}`);
	assert.strictEqual(requests.filter((q) => q.addr === 0x0800).length, 1, 'slow block read only once');
	assert.strictEqual(poller.sent[1][0].payload.details.systemConfig.maxFeedIntoGridPercent, 70, 'slow block cached');
	await close(poller); await close(cfg);
	server.close();
});
