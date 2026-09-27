'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { decodeBlock, BLOCKS } = require('../lib/registers');
const cmd = require('../lib/commands');
const { createRegisters } = require('./mock-server');

const regs = createRegisters();
const block = (n) => Array.from(regs.slice(BLOCKS[n].start, BLOCKS[n].start + BLOCKS[n].count));

test('blocks respect the Modbus limit of 125 registers', () => {
	Object.values(BLOCKS).forEach((b) => assert.ok(b.count >= 1 && b.count <= 125));
});

test('grid meter: signed values and scaling', () => {
	const g = decodeBlock('grid', block('grid'));
	assert.strictEqual(g.totalEnergyFeedToGrid, 1234.56);
	assert.strictEqual(g.current[0], -5.2);
	assert.strictEqual(g.frequency, 50.01);
	assert.strictEqual(g.activePower[0], -1200);
	assert.strictEqual(g.totalActivePower, -720);
	assert.strictEqual(g.powerFactor[0], -0.98);
});

test('battery', () => {
	const b = decodeBlock('battery', block('battery'), { platform: 'EMS3.x' });
	assert.strictEqual(b.voltage, 512);
	assert.strictEqual(b.current, -10.5);
	assert.strictEqual(b.soc, 87.3);
	assert.deepStrictEqual(b.status, { raw: 257, charge: 1, discharge: 1 });
	assert.strictEqual(b.minCellVoltage.value, 3.301);
	assert.strictEqual(b.cellVoltageSpread, 0.041);
	assert.strictEqual(b.type.text, 'Smile-BAT-10.1P');
	assert.deepStrictEqual(b.warning.active.map((a) => a.text), ['Temperature imbalance', 'Cell over voltage']);
	assert.strictEqual(b.chargeEnergy, 1234.5);
	assert.strictEqual(b.power, -2300);
	assert.strictEqual(b.faults.length, 6);
});

test('inverter: addresses after fault1', () => {
	const i = decodeBlock('inverter', block('inverter'));
	assert.strictEqual(i.pvPowerTotal, 4000);
	assert.strictEqual(i.totalPvEnergy, 9876.5);
	assert.strictEqual(i.workMode.text, 'Online');
	assert.strictEqual(i.batteryVoltage, 512);
	assert.strictEqual(i.batteryPower, -2300);
	assert.strictEqual(i.powerFactor, 1);
	assert.strictEqual(i.powerTotal, 3000);
});

test('info, config, time period, dispatch', () => {
	assert.strictEqual(decodeBlock('inverterInfo', block('inverterInfo')).serialNumber, 'AL5002021030123');
	const si = decodeBlock('systemInfo', block('systemInfo'));
	assert.strictEqual(si.emsSerialNumber, 'AL9002012345678');
	assert.deepStrictEqual(si.systemTime, { year: 2026, month: 9, day: 27, hour: 20, minute: 8, second: 0 });
	const sc = decodeBlock('systemConfig', block('systemConfig'));
	assert.strictEqual(sc.localIp, '192.168.4.84');
	assert.strictEqual(sc.systemMode.text, 'DC');
	const tp = decodeBlock('timePeriod', block('timePeriod'));
	assert.strictEqual(tp.upsReserveSoc, 10);
	assert.strictEqual(tp.chargeCutSoc, 100);
	assert.strictEqual(decodeBlock('timePeriod', block('timePeriod'), { socScale: 1 }).upsReserveSoc, 100);
	const d = decodeBlock('dispatch', block('dispatch'));
	assert.strictEqual(d.active, false);
	assert.strictEqual(d.activePower, 0);
});

test('dispatch encoding', () => {
	const f = cmd.encodeDispatch({ power: -3000, soc: 90, duration: 900 });
	assert.strictEqual(f.address, 0x0880);
	assert.deepStrictEqual(f.values, [1, 0, 29000, 0, 32000, 2, 225, 0, 900]);
	assert.throws(() => cmd.encodeDispatch({ power: 6000, maxPower: 5000 }), RangeError);
	assert.throws(() => cmd.encodeDispatch({ power: 'x' }), TypeError);
	assert.throws(() => cmd.encodeDispatch({}), TypeError);
	assert.deepStrictEqual(cmd.encodeDispatch({ power: 2000 }).values.slice(5, 7), [2, 25]);
});

test('time period read-modify-write', () => {
	const cur = block('timePeriod');
	const f = cmd.encodeTimePeriod(cur, { flag: 1, chargeCutSoc: 90, charge1: { start: '01:30', stop: '05:00' } });
	const at = (a) => f.values[a - 0x084F];
	assert.strictEqual(at(0x084F), 1);
	assert.strictEqual(at(0x0855), 900);
	assert.strictEqual(at(0x0856), 1); assert.strictEqual(at(0x085E), 30);
	assert.strictEqual(at(0x0857), 5); assert.strictEqual(at(0x085F), 0);
	assert.strictEqual(at(0x0850), 100);
	assert.throws(() => cmd.encodeTimePeriod(cur, { charge1: { start: '25:00' } }), RangeError);
});
