'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { decodeBlock, BLOCKS } = require('../lib/registers');
const { computeLive, DailyTracker, collectAlarms } = require('../lib/derived');
const { isStoreConfigured } = require('../lib/context-store');
const { createRegisters } = require('./mock-server');

function details(regs) {
	const block = (n) => Array.from(regs.slice(BLOCKS[n].start, BLOCKS[n].start + BLOCKS[n].count));
	return {
		grid: decodeBlock('grid', block('grid')),
		battery: decodeBlock('battery', block('battery')),
		inverter: decodeBlock('inverter', block('inverter')),
		systemRun: decodeBlock('systemRun', block('systemRun'))
	};
}
const u32 = (r, a, v) => { r[a] = (v >>> 16) & 0xFFFF; r[a + 1] = v & 0xFFFF; };
const memStore = () => { const m = {}; return { get: (k) => m[k], set: (k, v) => { m[k] = JSON.parse(JSON.stringify(v)); }, m }; };

test('live values with cloud-node keys', () => {
	const l = computeLive(details(createRegisters()));
	assert.deepStrictEqual(l, {
		modules: 4000, grid: -720, battery: -2300, soc: 87.3, consumption: 980,
		gridImport: 0, gridExport: 720, batteryCharge: 2300, batteryDischarge: 0,
		selfConsumptionRate: 82, autarky: 100
	});
	assert.deepStrictEqual(computeLive({ grid: details(createRegisters()).grid }), { grid: -720 });
});

test('daily values, midnight rollover and counter reset', () => {
	const regs = createRegisters();
	const store = memStore();
	const t = new DailyTracker(store);
	const day1 = new Date(2026, 8, 27, 23, 58).getTime();

	let r = t.update(details(regs), day1);
	assert.strictEqual(r.daily.pv, 0);
	assert.strictEqual(r.daily.complete, false, 'started at 23:58');
	assert.strictEqual(r.yesterday, null);

	u32(regs, 0x043E, 98765 + 20); // +2.0 kWh PV
	u32(regs, 0x0010, 123456 + 50); // +0.5 kWh feed
	u32(regs, 0x0012, 654321 + 30); // +0.3 kWh import
	u32(regs, 0x0120, 12345 + 5); // +0.5 kWh charge
	r = t.update(details(regs), day1 + 60000);
	assert.strictEqual(r.daily.pv, 2);
	assert.strictEqual(r.daily.gridFeed, 0.5);
	assert.strictEqual(r.daily.gridImport, 0.3);
	assert.strictEqual(r.daily.consumption, 1.3);
	assert.strictEqual(r.daily.selfConsumptionRate, 75);

	const t2 = new DailyTracker(store);
	r = t2.update(details(regs), day1 + 90000);
	assert.strictEqual(r.daily.pv, 2);

	u32(regs, 0x043E, 10);
	r = t2.update(details(regs), day1 + 100000);
	assert.strictEqual(r.daily.pv, 2);
	u32(regs, 0x043E, 15);
	r = t2.update(details(regs), day1 + 110000);
	assert.strictEqual(r.daily.pv, 2.5);

	r = t2.update(details(regs), day1 + 5 * 60000);
	assert.strictEqual(r.daily.day, '2026-09-28');
	assert.strictEqual(r.daily.pv, 0);
	assert.strictEqual(r.daily.complete, true);
	assert.strictEqual(r.yesterday.day, '2026-09-27');
	assert.strictEqual(r.yesterday.pv, 2.5);
	assert.strictEqual(r.yesterday.complete, false);

	r = t2.update({}, day1 + 6 * 60000);
	assert.strictEqual(r.daily.day, '2026-09-28');
});

test('daily.complete: restart during the day with and without persistent store', () => {
	const regs = createRegisters();
	const midnight = new Date(2026, 8, 28, 0, 0, 20).getTime();
	const noon = new Date(2026, 8, 28, 12, 0).getTime();

	const persistent = memStore();
	new DailyTracker(persistent).update(details(regs), midnight);
	u32(regs, 0x043E, 98765 + 100); // +10 kWh
	let r = new DailyTracker(persistent).update(details(regs), noon);
	assert.strictEqual(r.daily.complete, true);
	assert.strictEqual(r.daily.pv, 10);

	r = new DailyTracker(memStore()).update(details(regs), noon);
	assert.strictEqual(r.daily.complete, false);
	assert.strictEqual(r.daily.pv, 0);

	const old = memStore();
	old.set('dayBase', { day: '2026-09-28', since: midnight, counters: { pv: 9876.5, gridFeed: 0, gridImport: 0,
		batteryCharge: 0, batteryDischarge: 0, batteryChargeFromGrid: 0 } });
	r = new DailyTracker(old).update(details(regs), noon);
	assert.strictEqual(r.daily.complete, true);
	assert.strictEqual(old.m.dayBase.complete, true);
});

test('context store check', () => {
	assert.strictEqual(isStoreConfigured(undefined, undefined), true);
	assert.strictEqual(isStoreConfigured('', undefined), true);
	assert.strictEqual(isStoreConfigured('default', undefined), true);
	assert.strictEqual(isStoreConfigured('memory', undefined), true);
	assert.strictEqual(isStoreConfigured('file', undefined), false);
	const cs = { default: { module: 'memory' }, file: { module: 'localfilesystem' } };
	assert.strictEqual(isStoreConfigured('file', cs), true);
	assert.strictEqual(isStoreConfigured('File', cs), false, 'case sensitive like Node-RED');
	assert.strictEqual(isStoreConfigured('disk', cs), false);
});

test('alarms and warnings with texts', () => {
	const regs = createRegisters();
	regs[0x08D5] = 0x10; // Grid_Meter_Lost
	u32(regs, 0x043A, 1 << 7); // insulation_fault
	u32(regs, 0x0436, 1 << 11); // grid_loss_alarm
	const a = collectAlarms(details(regs), { inverter: { age: 400, stale: true, error: 'Timeout' } });
	assert.deepStrictEqual(a.alarms, ['System: Grid_Meter_Lost', 'Inverter: insulation_fault', 'Stale data: inverter (Timeout)']);
	assert.deepStrictEqual(a.warnings, ['Battery: Temperature imbalance', 'Battery: Cell over voltage', 'Inverter: grid_loss_alarm']);
});
