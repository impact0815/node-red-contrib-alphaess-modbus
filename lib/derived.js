'use strict';
/**
 * Derived values: live power flows, daily energy, alarms.
 * Sign conventions: grid + = import / - = export, battery + = discharge / - = charge.
 */
const { round } = require('./registers');

const pct = (v) => round(Math.max(0, Math.min(100, v)), 1);

/**
 * Live values. Keys consumption/grid/modules/battery/soc are identical to the
 * cloud node "Alpha ESS Monitoring" (node-red-contrib-alphaess).
 */
function computeLive(d, opts) {
	opts = opts || {};
	const s = {};
	const withAc = opts.includePvMeter && d.pvMeter;
	if (d.inverter || withAc) {
		s.modules = (d.inverter ? d.inverter.pvPowerTotal : 0) + (withAc ? Math.abs(d.pvMeter.totalActivePower) : 0);
	}
	if (d.grid) s.grid = d.grid.totalActivePower;
	if (d.battery) {
		s.battery = d.battery.power;
		s.soc = d.battery.soc;
	}
	if (s.modules !== undefined && s.grid !== undefined && s.battery !== undefined) {
		s.consumption = Math.max(0, s.modules + s.grid + s.battery);
		s.gridImport = Math.max(0, s.grid);
		s.gridExport = Math.max(0, -s.grid);
		s.batteryCharge = Math.max(0, -s.battery);
		s.batteryDischarge = Math.max(0, s.battery);
		s.selfConsumptionRate = s.modules > 0 ? pct((s.modules - s.gridExport) / s.modules * 100) : null;
		s.autarky = s.consumption > 0 ? pct((s.consumption - s.gridImport) / s.consumption * 100) : null;
	}
	return s;
}

// ------------------------------------------------------------------ daily ----
const COUNTERS = ['pv', 'gridFeed', 'gridImport', 'batteryCharge', 'batteryDischarge', 'batteryChargeFromGrid'];

/** a day counts as complete if counting started at most this long after local midnight */
const COMPLETE_TOLERANCE_MS = 15 * 60 * 1000;

function localDay(ts) {
	const d = new Date(ts);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function localMidnight(ts) {
	const d = new Date(ts);
	return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function readCounters(d, opts) {
	if (!d.grid || !d.battery || !d.inverter) return null;
	if (opts.includePvMeter && !d.systemRun) return null;
	return {
		pv: d.inverter.totalPvEnergy + (opts.includePvMeter ? d.systemRun.pvInverterEnergy : 0),
		gridFeed: d.grid.totalEnergyFeedToGrid,
		gridImport: d.grid.totalEnergyConsumeFromGrid,
		batteryCharge: d.battery.chargeEnergy,
		batteryDischarge: d.battery.dischargeEnergy,
		batteryChargeFromGrid: d.battery.energyChargeFromGrid
	};
}

/**
 * Daily energy from the lifetime counters (difference since local midnight).
 * store: { get(key), set(key, value) } – e.g. Node-RED node context.
 *
 * daily.complete is true if counting started within COMPLETE_TOLERANCE_MS
 * after local midnight, i.e. the values cover the whole day. It is false after
 * a restart during the day without a persistent context store.
 */
class DailyTracker {
	constructor(store, opts) {
		this.store = store;
		this.tolerance = (opts && opts.completeTolerance) || COMPLETE_TOLERANCE_MS;
	}

	update(d, now, opts) {
		opts = opts || {};
		const today = localDay(now);
		let base = this.store.get('dayBase');
		const last = this.store.get('dailyLast') || null;
		let yesterday = this.store.get('yesterday') || null;
		const c = readCounters(d, opts);
		if (!c) return { daily: last && last.day === today ? last : null, yesterday };

		let changed = false;
		if (!base || base.day !== today) {
			if (base && last && last.day === base.day) {
				yesterday = last;
				this.store.set('yesterday', yesterday);
			}
			base = { day: today, since: now, counters: Object.assign({}, c) };
			changed = true;
		}
		if (typeof base.complete !== 'boolean') {
			// also for bases stored by versions before 0.2.1
			base.complete = base.since - localMidnight(base.since) <= this.tolerance;
			changed = true;
		}
		const prevToday = (k) => (last && last.day === today && typeof last[k] === 'number' ? last[k] : 0);
		const daily = { day: today, since: new Date(base.since).toISOString(), complete: base.complete };
		COUNTERS.forEach((k) => {
			if (typeof base.counters[k] !== 'number') {
				base.counters[k] = c[k] - prevToday(k);
				changed = true;
			}
			let diff = c[k] - base.counters[k];
			if (diff < -0.05) {
				// counter was reset or replaced – keep today's value and continue from the new counter
				base.counters[k] = c[k] - prevToday(k);
				diff = prevToday(k);
				changed = true;
			}
			daily[k] = round(Math.max(0, diff), 2);
		});
		daily.consumption = round(Math.max(0,
			daily.pv + daily.gridImport - daily.gridFeed + daily.batteryDischarge - daily.batteryCharge), 2);
		const houseImport = Math.max(0, daily.gridImport - daily.batteryChargeFromGrid);
		daily.selfConsumptionRate = daily.pv > 0 ? pct((daily.pv - daily.gridFeed) / daily.pv * 100) : null;
		daily.autarky = daily.consumption > 0 ? pct((daily.consumption - houseImport) / daily.consumption * 100) : null;

		if (changed) this.store.set('dayBase', base);
		this.store.set('dailyLast', daily);
		return { daily, yesterday };
	}
}

// ----------------------------------------------------------------- alarms ----
function collectAlarms(d, blocks) {
	const alarms = [];
	const warnings = [];
	const addBits = (arr, prefix, b) => { if (b && b.active) b.active.forEach((a) => arr.push(`${prefix}: ${a.text}`)); };
	const hex = (v) => '0x' + v.toString(16).toUpperCase().padStart(8, '0');

	if (d.systemRun) addBits(alarms, 'System', d.systemRun.systemFault);
	if (d.battery) {
		addBits(alarms, 'Battery', d.battery.fault);
		(d.battery.faults || []).forEach((v, i) => { if (v) alarms.push(`Battery fault${i + 1}: ${hex(v)}`); });
		addBits(warnings, 'Battery', d.battery.warning);
		(d.battery.warnings || []).forEach((v, i) => { if (v) warnings.push(`Battery warning${i + 1}: ${hex(v)}`); });
	}
	if (d.inverter) {
		['fault1', 'fault2', 'faultExtend1', 'faultExtend2'].forEach((k) => addBits(alarms, 'Inverter', d.inverter[k]));
		['faultExtend3', 'faultExtend4'].forEach((k) => { if (d.inverter[k]) alarms.push(`Inverter ${k}: ${hex(d.inverter[k])}`); });
		if (d.inverter.workMode && d.inverter.workMode.raw === 4) alarms.push('Inverter: work mode Fault');
		if (d.inverter.warningBits) {
			addBits(warnings, 'Inverter', d.inverter.warningBits.warning1);
			addBits(warnings, 'Inverter', d.inverter.warningBits.warning2);
		} else {
			['warning1', 'warning2'].forEach((k) => { if (d.inverter[k]) warnings.push(`Inverter ${k}: ${hex(d.inverter[k])}`); });
		}
	}
	Object.keys(blocks || {}).forEach((k) => {
		if (blocks[k].stale) alarms.push(`Stale data: ${k}` + (blocks[k].error ? ` (${blocks[k].error})` : ''));
	});
	return { alarms, warnings };
}

module.exports = { computeLive, DailyTracker, collectAlarms, localDay, localMidnight, COUNTERS, COMPLETE_TOLERANCE_MS };
