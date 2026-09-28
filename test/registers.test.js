'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { decodeBlock, BLOCKS } = require('../lib/registers');
const cmd = require('../lib/commands');
const { createRegisters } = require('./mock-server');

const regs = createRegisters();
const block = (n, legacy) => {
	const b = BLOCKS[n];
	return Array.from(regs.slice(b.start, b.start + (legacy && b.minCount ? b.minCount : b.count)));
};

test('blocks respect the Modbus limit of 125 registers', () => {
	Object.values(BLOCKS).forEach((b) => {
		assert.ok(b.count >= 1 && b.count <= 125);
		if (b.minCount) assert.ok(b.minCount < b.count);
	});
});

test('grid meter: signed values, scaling, per-phase energy', () => {
	const g = decodeBlock('grid', block('grid'));
	assert.strictEqual(g.totalEnergyFeedToGrid, 1234.56);
	assert.strictEqual(g.current[0], -5.2);
	assert.strictEqual(g.frequency, 50.01);
	assert.strictEqual(g.activePower[0], -1200);
	assert.strictEqual(g.totalActivePower, -720);
	assert.strictEqual(g.powerFactor[0], -0.98);
	assert.deepStrictEqual(g.energyConsumeFromGridPhase, [2000, 2300, 2243.21]);
	assert.deepStrictEqual(g.energyFeedToGridPhase, [410, 420, 404.56]);
	const legacy = decodeBlock('grid', block('grid', true));
	assert.strictEqual(legacy.totalActivePower, -720);
	assert.strictEqual(legacy.energyConsumeFromGridPhase, undefined);
	assert.strictEqual(decodeBlock('pvMeter', block('pvMeter')).energyFeedToGridPhase, undefined);
});

test('battery and battery serial numbers', () => {
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

	const w = Array.from(regs.slice(0x0100, 0x0100 + 73));
	w[0x011D - 0x0100] = 1 << 12 | 1 << 8;
	assert.deepStrictEqual(decodeBlock('battery', w).warning.active.map((a) => a.text),
		['Software versions inconsistent', 'BMS fan error']);

	assert.deepStrictEqual(decodeBlock('batteryInfo', block('batteryInfo')).serialNumbers,
		['BAT0000001', 'BAT0000002', 'BAT0000003']);
});

test('inverter: addresses after fault1, warnings, fault extend, PV total power register', () => {
	const i = decodeBlock('inverter', block('inverter'));
	assert.strictEqual(i.pvPowerTotal, 4000);
	assert.strictEqual(i.pvPowerTotalRegister, 4000);
	assert.strictEqual(i.totalPvEnergy, 9876.5);
	assert.strictEqual(i.workMode.text, 'Online');
	assert.strictEqual(i.batteryVoltage, 512);
	assert.strictEqual(i.batteryPower, -2300);
	assert.strictEqual(i.powerFactor, 1);
	assert.strictEqual(i.powerTotal, 3000);
	assert.strictEqual(decodeBlock('inverter', block('inverter', true)).pvPowerTotalRegister, undefined);

	const v = block('inverter');
	const set32 = (a, x) => { v[a - 0x0400] = (x >>> 16) & 0xFFFF; v[a - 0x0400 + 1] = x & 0xFFFF; };
	set32(0x0436, 1 << 11); // grid_loss_alarm
	set32(0x0438, 1 << 8); // no_pv_input_alarm
	set32(0x044B, 1 << 31); // pv1_ct
	set32(0x044D, 1 << 7); // watchdog
	const d = decodeBlock('inverter', v);
	assert.strictEqual(d.warning1, 1 << 11);
	assert.deepStrictEqual(d.warningBits.warning1.active.map((a) => a.text), ['grid_loss_alarm']);
	assert.deepStrictEqual(d.warningBits.warning2.active.map((a) => a.text), ['no_pv_input_alarm']);
	assert.deepStrictEqual(d.faultExtend1.active.map((a) => a.text), ['pv1_ct']);
	assert.deepStrictEqual(d.faultExtend2.active.map((a) => a.text), ['watchdog']);
});

test('info, config, time period, dispatch', () => {
	const ii = decodeBlock('inverterInfo', block('inverterInfo'));
	assert.strictEqual(ii.serialNumber, 'AL5002021030123');
	assert.strictEqual(ii.armSoftwareVersion, 'ARM1.02');
	assert.strictEqual(decodeBlock('inverterInfo', block('inverterInfo', true)).armSoftwareVersion, undefined);

	const si = decodeBlock('systemInfo', block('systemInfo'));
	assert.strictEqual(si.emsSerialNumber, 'AL9002012345678');
	assert.deepStrictEqual(si.systemTime, { year: 2026, month: 9, day: 27, hour: 20, minute: 8, second: 0 });
	assert.strictEqual(si.emsVersion.text, '2.5.18-B');
	assert.strictEqual(si.wifiSerialNumber, 'WIFI12345678');
	const siLegacy = decodeBlock('systemInfo', block('systemInfo', true));
	assert.strictEqual(siLegacy.emsVersion.text, '2.5.18');
	assert.strictEqual(siLegacy.wifiSerialNumber, undefined);

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
	assert.deepStrictEqual(d.pvSwitch, { raw: 0, text: 'not set' });
	assert.strictEqual(decodeBlock('dispatch', block('dispatch', true)).pvSwitch, undefined);
});

test('dispatch encoding', () => {
	const f = cmd.encodeDispatch({ power: -3000, soc: 90, duration: 900 });
	assert.strictEqual(f.address, 0x0880);
	assert.deepStrictEqual(f.values, [1, 0, 29000, 0, 32000, 2, 225, 0, 900]);
	assert.throws(() => cmd.encodeDispatch({ power: 6000, maxPower: 5000 }), RangeError);
	assert.throws(() => cmd.encodeDispatch({ power: 'x' }), TypeError);
	assert.throws(() => cmd.encodeDispatch({}), TypeError);
	assert.deepStrictEqual(cmd.encodeDispatch({ power: 2000 }).values.slice(5, 7), [2, 25]);
	assert.strictEqual(cmd.encodeDispatch({ power: 0, mode: 19 }).values[5], 19, 'No Battery Charge');
	assert.throws(() => cmd.encodeDispatch({ power: 0, mode: 20 }), /mode must be one of/, 'BurnIn test mode');
	assert.throws(() => cmd.encodeDispatch({ power: 0, mode: 22 }), /mode must be one of/, 'OSW mode');
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

test('diffFrames: only changed registers, one frame per contiguous run', () => {
	assert.deepStrictEqual(cmd.diffFrames(100, [1, 2, 3], [1, 2, 3]), []);
	assert.deepStrictEqual(cmd.diffFrames(100, [1, 2, 3, 4, 5], [1, 9, 9, 4, 7]), [
		{ address: 101, values: [9, 9] },
		{ address: 104, values: [7] }
	]);
	assert.deepStrictEqual(cmd.diffFrames(0, [0xFFFF], [-1]), [], 'compared as uint16');
	assert.throws(() => cmd.diffFrames(0, [1], [1, 2]), TypeError);

	const cur = block('timePeriod');
	const next = cmd.encodeTimePeriod(cur, { upsReserveSoc: 20 }).values;
	assert.deepStrictEqual(cmd.diffFrames(0x084F, cur, next), [{ address: 0x0850, values: [200] }]);
});
