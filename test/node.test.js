'use strict';
/* Integration tests: loads the Node-RED nodes with a minimal RED stub and talks to the simulator. */
const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const { createRegisters, createServer, NEW_RANGES } = require('./mock-server');

function fakeRED(extra) {
	const types = {};
	const nodes = {};
	const RED = Object.assign({
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
	}, extra);
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Registers nodes and servers of a test for cleanup. Cleanup also runs when an
 * assertion fails, so a failing test never leaves open sockets or timers behind
 * (which would keep the test run from ending).
 */
function resources(t) {
	const items = [];
	t.after(async () => {
		for (const item of items.reverse()) {
			if (item.server) {
				if (item.server.listening) item.server.close();
			} else {
				await close(item.node);
			}
		}
	});
	return {
		node(n) { items.push({ node: n }); return n; },
		async server(s) {
			items.push({ server: s });
			await new Promise((r) => s.listen(0, '127.0.0.1', r));
			return s.address().port;
		}
	};
}

const ALL = {
	block_grid: true, block_battery: true, block_inverter: true, block_systemRun: true,
	block_systemConfig: true, block_timePeriod: true, block_dispatch: true, block_info: true
};

test('read cycle, slow blocks, alarm output, MQTT', async (t) => {
	const res = resources(t);
	const requests = [];
	const opts = { onRequest: (r) => requests.push(r) };
	const port = await res.server(createServer(createRegisters(), opts));
	const { RED, types, nodes } = fakeRED();
	require('../alphaess-modbus.js')(RED);
	const broker = fakeBroker(nodes, 'mq');
	res.node(new types['alphaess-modbus-config']({ id: 'c1', host: '127.0.0.1', port, timeout: 1000, delay: 0 }));
	const n = res.node(new types['alphaess-modbus'](Object.assign({
		id: 'n1', server: 'c1', interval: 0, slowInterval: 300, staleAfter: 1, mqttBroker: 'mq', mqttPrefix: 'pv/'
	}, ALL)));
	assert.ok(broker.users['n1:mqtt'], 'registered at broker');
	assert.deepStrictEqual(n.warnings, [], 'no store warning with default store');
	assert.deepStrictEqual(n.logs, [], 'no write notice without write access');

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
	assert.strictEqual(n.statuses.slice(-1)[0].text, 'PV 4000W | Grid -720W | SOC 87.3% | Load 980W');

	const topics = broker.published.map((m) => m.topic);
	['pv/consumption', 'pv/soc', 'pv/autarky', 'pv/daily/pv', 'pv/daily/complete', 'pv/status', 'pv/alarm', 'pv/info']
		.forEach((tp) => assert.ok(topics.includes(tp), tp));
	assert.ok(!topics.includes('pv/daily/since') && !topics.includes('pv/daily/day'));
	assert.ok(!topics.some((tp) => tp.startsWith('pv/details/')), 'details off by default');
	assert.strictEqual(broker.published.find((m) => m.topic === 'pv/consumption').payload, '980');
	assert.strictEqual(broker.published.find((m) => m.topic === 'pv/info').retain, true);

	// manual read forces slow blocks
	requests.length = 0;
	broker.published.length = 0;
	r = await input(n, { topic: 'read' });
	assert.ifError(r.err);
	assert.ok(requests.some((q) => q.addr === 0x0800), 'manual read forces slow blocks');

	// inverter fails -> after "stale after" (1 s) an alarm is raised once
	opts.failAddress = 0x0400;
	await sleep(1100);
	r = await input(n, {});
	[data, alarm] = r.out[0];
	assert.match(data.errors.inverter, /exception 2/);
	assert.strictEqual(data.payload.blocks.inverter.stale, true, 'stale after more than 1 s (exact age, not rounded)');
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
});

test('a single failed read is bridged with the last value', async (t) => {
	const res = resources(t);
	const opts = {};
	const port = await res.server(createServer(createRegisters(), opts));
	const { RED, types } = fakeRED();
	require('../alphaess-modbus.js')(RED);
	res.node(new types['alphaess-modbus-config']({ id: 'c', host: '127.0.0.1', port, delay: 0 }));
	const n = res.node(new types['alphaess-modbus']({ id: 'b', server: 'c', interval: 0, staleAfter: 60,
		block_grid: true, block_battery: true, block_inverter: true }));

	let r = await input(n, {});
	assert.strictEqual(r.out[0][0].payload.consumption, 980);
	opts.failAddress = 0x0400;
	r = await input(n, {});
	const [data, alarm] = r.out[0];
	assert.match(data.errors.inverter, /exception 2/);
	assert.strictEqual(data.payload.blocks.inverter.stale, false);
	assert.strictEqual(data.payload.consumption, 980, 'last inverter value still used');
	assert.strictEqual(alarm, null, 'no alarm for a single failed read');
});

test('older firmware: automatic fallback to the register lengths of V1.1', async (t) => {
	const res = resources(t);
	const requests = [];
	const port = await res.server(createServer(createRegisters(), { unsupported: NEW_RANGES, onRequest: (q) => requests.push(q) }));
	const { RED, types } = fakeRED();
	require('../alphaess-modbus.js')(RED);
	res.node(new types['alphaess-modbus-config']({ id: 'c', host: '127.0.0.1', port, delay: 0 }));
	const n = res.node(new types['alphaess-modbus'](Object.assign({ id: 'legacy', server: 'c', interval: 0 }, ALL)));

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

	requests.length = 0;
	r = await input(n, {});
	assert.ifError(r.err);
	assert.deepStrictEqual(requests.filter((q) => q.addr === 0x0010).map((q) => q.qty), [39]);
	assert.deepStrictEqual(requests.filter((q) => q.addr === 0x0400).map((q) => q.qty), [83]);

	requests.length = 0;
	r = await input(n, { topic: 'readInfo' });
	assert.ifError(r.err);
	assert.ok(!requests.some((q) => q.addr === 0x0150));
	assert.strictEqual(r.out[0][2].errors, undefined);
});

test('write commands: output 3, unchanged detection, only changed registers, rate limit', async (t) => {
	const res = resources(t);
	const requests = [];
	const regs = createRegisters();
	const port = await res.server(createServer(regs, { onRequest: (q) => requests.push(q) }));
	const { RED, types } = fakeRED();
	require('../alphaess-modbus.js')(RED);
	res.node(new types['alphaess-modbus-config']({ id: 'c', host: '127.0.0.1', port, delay: 0 }));
	const ro = res.node(new types['alphaess-modbus']({ id: 'ro', server: 'c', interval: 0, block_battery: true }));
	const rw = res.node(new types['alphaess-modbus']({ id: 'rw', server: 'c', interval: 0, allowWrite: true, maxPower: 5000, writeInterval: 1 }));
	const writes = () => requests.filter((q) => q.fc === 16).map((q) => [q.addr, q.qty]);
	const resp = (r) => { assert.ifError(r.err); assert.strictEqual(r.out[0][0], null); assert.strictEqual(r.out[0][1], null); return r.out[0][2]; };

	assert.ok(rw.logs.some((l) => /Write access is enabled.*own risk/.test(l)), 'notice at start when write access is enabled');

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
	assert.match(String(r.err), /Unknown topic "unknown"/);
});

test('runtime texts are translated with RED._, data stays English', async (t) => {
	const res = resources(t);
	const port = await res.server(createServer(createRegisters()));
	const de = require('../locales/de/alphaess-modbus.json');
	const { lookup, interpolate } = require('../lib/i18n');
	// minimal RED._ like Node-RED with server language "de"
	const _ = (key, vars) => {
		const s = lookup(de, key);
		return typeof s === 'string' ? interpolate(s, vars) : key;
	};
	const { RED, types } = fakeRED({ _ });
	require('../alphaess-modbus.js')(RED);
	res.node(new types['alphaess-modbus-config']({ id: 'c', host: '127.0.0.1', port, delay: 0 }));
	const n = res.node(new types['alphaess-modbus']({ id: 'de', server: 'c', interval: 0,
		block_grid: true, block_battery: true, block_inverter: true }));
	assert.strictEqual(n.statuses[0].text, 'manueller Modus');

	let r = await input(n, {});
	assert.strictEqual(n.statuses.slice(-1)[0].text, 'PV 4000W | Netz -720W | SOC 87.3% | Last 980W');
	assert.deepStrictEqual(r.out[0][1].payload.warnings, ['Battery: Temperature imbalance', 'Battery: Cell over voltage'],
		'alarm and warning texts in the payload are not translated');

	r = await input(n, { topic: 'dispatch', payload: { power: -1000 } });
	assert.match(String(r.err), /Schreiben ist deaktiviert/);
	r = await input(n, { topic: 'xyz' });
	assert.match(String(r.err), /Unbekanntes Topic "xyz"/);
});

test('rate limit can be disabled', async (t) => {
	const res = resources(t);
	const port = await res.server(createServer(createRegisters()));
	const { RED, types } = fakeRED();
	require('../alphaess-modbus.js')(RED);
	res.node(new types['alphaess-modbus-config']({ id: 'c', host: '127.0.0.1', port, delay: 0 }));
	const rw = res.node(new types['alphaess-modbus']({ id: 'rw', server: 'c', interval: 0, allowWrite: true, writeInterval: 0 }));
	for (const soc of [20, 30, 40]) {
		const r = await input(rw, { topic: 'timePeriod', payload: { upsReserveSoc: soc } });
		assert.ifError(r.err);
		assert.strictEqual(r.out[0][2].payload.upsReserveSoc, soc);
	}
});

test('unreachable host', async (t) => {
	const res = resources(t);
	// a port that was just released is closed; this avoids relying on a fixed port number
	const probe = createServer(createRegisters());
	await new Promise((r) => probe.listen(0, '127.0.0.1', r));
	const port = probe.address().port;
	await new Promise((r) => probe.close(r));

	const { RED, types } = fakeRED();
	require('../alphaess-modbus.js')(RED);
	res.node(new types['alphaess-modbus-config']({ id: 'bad', host: '127.0.0.1', port, timeout: 3000 }));
	const n = res.node(new types['alphaess-modbus']({ id: 'x', server: 'bad', interval: 0, block_grid: true }));
	const r = await input(n, {});
	assert.ok(r.out[0][0].errors.grid, 'read error reported');
	assert.strictEqual(n.statuses.slice(-1)[0].fill, 'red');
});

test('polling mode', async (t) => {
	const res = resources(t);
	const requests = [];
	const port = await res.server(createServer(createRegisters(), { onRequest: (q) => requests.push(q) }));
	const { RED, types } = fakeRED();
	require('../alphaess-modbus.js')(RED);
	res.node(new types['alphaess-modbus-config']({ id: 'p', host: '127.0.0.1', port, delay: 0 }));
	const poller = res.node(new types['alphaess-modbus']({ id: 'poll', server: 'p', interval: 1, slowInterval: 300,
		block_battery: true, block_systemConfig: true }));
	assert.strictEqual(poller.statuses[0].text, 'polling every 1 s');
	await sleep(2300);
	assert.ok(poller.sent.length >= 2, `sent ${poller.sent.length}`);
	assert.strictEqual(requests.filter((q) => q.addr === 0x0800).length, 1, 'slow block read only once');
	assert.strictEqual(poller.sent[1][0].payload.details.systemConfig.maxFeedIntoGridPercent, 70, 'slow block cached');
});
