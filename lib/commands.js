'use strict';
/**
 * Encoders for the whitelisted writable AlphaESS registers.
 * Every function returns { address, values } for an FC16 write.
 * Deliberately NOT supported: safety test (0x1000+), reset/ATE (0x1100+),
 * CT calibration (0x11B9+), network/Modbus settings, battery MOS control.
 */

const DISPATCH_OFFSET = 32000;

function num(v, name) {
	const n = Number(v);
	if (v === null || v === '' || !Number.isFinite(n)) throw new TypeError(`${name} must be a number`);
	return n;
}

function clamp(v, min, max, name) {
	if (v < min || v > max) throw new RangeError(`${name} must be between ${min} and ${max} (got ${v})`);
	return v;
}

const split32 = (v) => { const u = v >>> 0; return [(u >>> 16) & 0xFFFF, u & 0xFFFF]; };

/**
 * Dispatch (0x0880..0x0888)
 * @param {object} p
 * @param {number} p.power           W, + = discharge, - = charge (same sign as battery power)
 * @param {number} [p.mode=2]        Note 7 (2 = State of Charge control)
 * @param {number} [p.soc]           target SOC in %, default 100 when charging, 10 when discharging
 * @param {number} [p.duration=300]  seconds
 * @param {number} [p.reactivePower=0]
 * @param {number} [p.maxPower]      optional safety limit in W
 */
function encodeDispatch(p) {
	p = p || {};
	const power = Math.round(num(p.power, 'power'));
	const limit = p.maxPower !== undefined ? num(p.maxPower, 'maxPower') : DISPATCH_OFFSET - 1;
	clamp(Math.abs(power), 0, limit, 'power');
	const reactive = Math.round(num(p.reactivePower === undefined ? 0 : p.reactivePower, 'reactivePower'));
	clamp(Math.abs(reactive), 0, DISPATCH_OFFSET - 1, 'reactivePower');
	const mode = Math.round(num(p.mode === undefined ? 2 : p.mode, 'mode'));
	clamp(mode, 1, 10, 'mode');
	const soc = num(p.soc === undefined ? (power < 0 ? 100 : 10) : p.soc, 'soc');
	clamp(soc, 0, 100, 'soc');
	const duration = Math.round(num(p.duration === undefined ? 300 : p.duration, 'duration'));
	clamp(duration, 1, 0xFFFFFFFF, 'duration');
	return {
		address: 0x0880,
		values: [1, ...split32(DISPATCH_OFFSET + power), ...split32(DISPATCH_OFFSET + reactive),
			mode, Math.round(soc / 0.4), ...split32(duration)]
	};
}

function encodeDispatchStop() {
	return { address: 0x0880, values: [0, ...split32(DISPATCH_OFFSET), ...split32(DISPATCH_OFFSET), 0, 0, 0, 0] };
}

/** Max feed into grid in percent (0x0800) */
function encodeFeedIn(percent) {
	const v = Math.round(num(percent, 'percent'));
	clamp(v, 0, 100, 'percent');
	return { address: 0x0800, values: [v] };
}

function parseHm(s, name) {
	const m = /^(\d{1,2}):(\d{2})$/.exec(String(s));
	if (!m) throw new TypeError(`${name} must be "HH:MM"`);
	const h = Number(m[1]), min = Number(m[2]);
	clamp(h, 0, 23, name + ' hour');
	clamp(min, 0, 59, name + ' minute');
	return [h, min];
}

/**
 * Time period control (0x084F..0x0861) – read-modify-write.
 * @param {number[]} current  19 raw registers as read from 0x084F
 * @param {object} p  { flag, upsReserveSoc, chargeCutSoc, charge1:{start,stop}, charge2, discharge1, discharge2 }
 * @param {number} [socScale=0.1]  %/bit according to the documentation
 */
function encodeTimePeriod(current, p, socScale) {
	if (!Array.isArray(current) || current.length !== 19) throw new TypeError('current must contain 19 registers');
	const scale = socScale || 0.1;
	const v = current.slice();
	const idx = (a) => a - 0x084F;
	p = p || {};
	if (p.flag !== undefined) v[idx(0x084F)] = clamp(Math.round(num(p.flag, 'flag')), 0, 3, 'flag');
	if (p.upsReserveSoc !== undefined) {
		v[idx(0x0850)] = Math.round(clamp(num(p.upsReserveSoc, 'upsReserveSoc'), 0, 100, 'upsReserveSoc') / scale);
	}
	if (p.chargeCutSoc !== undefined) {
		v[idx(0x0855)] = Math.round(clamp(num(p.chargeCutSoc, 'chargeCutSoc'), 0, 100, 'chargeCutSoc') / scale);
	}
	// [hour start, hour stop, minute start, minute stop]
	const slots = {
		discharge1: [0x0851, 0x0852, 0x085A, 0x085B],
		discharge2: [0x0853, 0x0854, 0x085C, 0x085D],
		charge1: [0x0856, 0x0857, 0x085E, 0x085F],
		charge2: [0x0858, 0x0859, 0x0860, 0x0861]
	};
	Object.keys(slots).forEach((k) => {
		if (!p[k]) return;
		const a = slots[k];
		if (p[k].start !== undefined) { const [h, m] = parseHm(p[k].start, k + '.start'); v[idx(a[0])] = h; v[idx(a[2])] = m; }
		if (p[k].stop !== undefined) { const [h, m] = parseHm(p[k].stop, k + '.stop'); v[idx(a[1])] = h; v[idx(a[3])] = m; }
	});
	return { address: 0x084F, values: v };
}

module.exports = { encodeDispatch, encodeDispatchStop, encodeFeedIn, encodeTimePeriod, DISPATCH_OFFSET };
