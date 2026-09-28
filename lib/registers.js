'use strict';
/**
 * AlphaESS register map, based on the "AlphaESS Household Modbus Register Parameter List"
 * (successor of "Register Parameter List V1.1"). Only household-relevant, readable blocks are included.
 *
 * count    = registers read with a current firmware
 * minCount = registers of the older documentation (V1.1). If a system rejects the longer
 *            request (Modbus exception 2/3), the node falls back to minCount automatically.
 */

// ---------------------------------------------------------------- blocks ----
const BLOCKS = {
	grid: { start: 0x0010, count: 51, minCount: 39, label: 'Grid meter' },
	pvMeter: { start: 0x0090, count: 39, label: 'PV meter' },
	battery: { start: 0x0100, count: 73, label: 'Battery' },
	batteryInfo: { start: 0x0150, count: 30, label: 'Battery serial numbers' },
	inverter: { start: 0x0400, count: 85, minCount: 83, label: 'Inverter' },
	inverterInfo: { start: 0x0640, count: 25, minCount: 20, label: 'Inverter info' },
	systemInfo: { start: 0x0740, count: 25, minCount: 15, label: 'System info' },
	systemConfig: { start: 0x0800, count: 18, label: 'System config' },
	timePeriod: { start: 0x084F, count: 19, label: 'Time period control' },
	dispatch: { start: 0x0880, count: 11, minCount: 9, label: 'Dispatch' },
	systemRun: { start: 0x08D0, count: 6, label: 'System running data' }
};

// ----------------------------------------------------------------- enums ----
const WORK_MODE = ['Wait', 'Online', 'UPS', 'Bypass', 'Fault', 'DC', 'SelfTest',
	'Check', 'Update Master', 'Update Slave', 'Update ARM'];

const BATTERY_TYPE = {
	2: 'M4860', 3: 'M48100', 13: '48112-P', 16: 'Smile5-BAT', 24: 'M4856-P',
	27: 'Smile-BAT-10.3P', 30: 'Smile-BAT-10.1P', 33: 'Smile-BAT-5.8P',
	34: 'Smile-BAT5-JP', 35: 'Smile-BAT-13.7P'
};

const RELAY_STATUS = ['Charge and discharge relays open', 'Only discharge relay closed',
	'Only charge relay closed', 'Charge and discharge relays closed'];

// Note 7 / Note 29
const DISPATCH_MODE = {
	1: 'Battery only charges from PV', 2: 'State of Charge control', 3: 'Load Following',
	4: 'Maximise Output', 5: 'Normal Mode', 6: 'Optimise Consumption',
	7: 'Maximise Consumption', 8: 'ECO Mode', 9: 'FCAS Mode', 10: 'PV Power Setting',
	19: 'No Battery Charge', 20: 'BurnIn Mode', 21: 'OSW Battery only charges from PV',
	22: 'OSW State of Charge control', 23: 'OSW Load Following', 25: 'OSW No Battery Charge'
};

const DISPATCH_PV_SWITCH = { 1: 'Open', 2: 'Close' };

const SYSTEM_MODE = { 1: 'AC', 2: 'DC', 3: 'Hybrid' };
const METER_CT = ['Grid & PV use CT', 'Grid CT, PV meter', 'Grid meter, PV CT', 'Grid & PV use meter'];
const TIME_PERIOD_FLAG = ['Disabled', 'Charge enabled', 'Discharge enabled', 'Charge & discharge enabled'];

// Bit tables (index = bit number)
const BATTERY_FAULT = { // Note 4
	'EMS2.5': {
		2: 'Cell Temp Differ', 3: 'Balancer Fault', 4: 'Charge Over Current', 5: 'Balancer Mos Fault',
		6: 'Discharge Over Current', 7: 'Pole Over Temp', 8: 'Cell Over Volt', 9: 'Cell Volt Differ',
		10: 'Discharge Low Temp', 12: 'Cell Low Volt', 13: 'ISO Comm Fault', 14: 'LMU SN Repeat',
		16: 'IR Fault', 17: 'LMU Comm Fault', 18: 'Cell Over Temp', 19: 'BMU Comm Fault',
		21: 'Charge Low Temp', 23: 'Volt Detect Fault', 24: 'Wire Harness Fault', 26: 'Relay Fault',
		27: 'LMU ID Repeat', 28: 'LMU ID Discontinuous', 29: 'Current Sensor Fault', 31: 'Temp Sensor Fault'
	},
	'EMS3.x': {
		0: 'Temperature sensor error', 1: 'Mos error', 2: 'Circuit breaker open',
		3: 'Dial switching mode inconsistence', 4: 'Slave battery communication lost', 5: 'Sn missing',
		6: 'Master battery communication lost', 7: 'Firmware versions inconsistence', 8: 'Multi master error',
		9: 'Mos high temperature', 10: 'Insulation fault', 11: 'Total pressure abnormal',
		12: 'Mos feedback failure', 13: 'Prefilled failure', 14: '17823 communication failure',
		15: '17841 communication failure', 16: 'Mos temperature sensor error'
	}
};

const BATTERY_WARNING = { // Note 28
	'EMS2.5': {},
	'EMS3.x': {
		0: 'Temperature imbalance', 1: 'Over temperature', 2: 'Discharge low temperature',
		3: 'Charge low temperature', 4: 'Discharge over current', 5: 'Charge over current',
		6: 'Cell over voltage', 7: 'Cell low voltage', 8: 'Software versions inconsistent',
		9: 'Mos temperature sensor error', 10: 'SOC inconsistent', 11: 'BMS communication lost',
		12: 'BMS fan error'
	}
};

const SYSTEM_FAULT = { // Note 6, platform EMS2.5/EMS3.5/EMS3.6
	0: 'Network_Card_Fault', 1: 'Rtc_Fault', 2: 'EEprom_Fault', 3: 'INV_Comms_Error',
	4: 'Grid_Meter_Lost', 5: 'PV_Meter_Lost', 6: 'BMS_Lost', 7: 'UPS_Battery_Volt_Low', 8: 'Backup_Overload',
	9: 'INV_Slave_Lost', 10: 'INV_Master_Lost', 11: 'Parallel_Comm_Error', 12: 'Parallel_Mode_Differ',
	13: 'Flash_Fault', 14: 'SDRAM error', 15: 'Extension CAN error', 16: 'inv type not specified'
};

const INVERTER_FAULT1 = ['Grid_OVP', 'Grid_UVP', 'Grid_OFP', 'Grid_UFP', 'phase_locked_fault', 'bus_ovp1',
	'bus_ovp2', 'insulation_fault', 'gfci_fault', 'gfci_test_fault', 'grid_relay_fault', 'over_temperature',
	'pv_reverse', 'bat_reverse', 'm_s_com_fault', 'display_com_fault', 'chip1_upgrade_fault', 'mppt1_ovp',
	'mppt1_sw_ocp', 'mppt1_hw_ocp', 'mppt1_otp', 'mppt2_ovp', 'mppt2_sw_ocp', 'mppt2_hw_ocp', 'mppt2_otp',
	'bat_ovp', 'bat_uvp', 'battery_lose', 'bat_otp', 'bat1_charge_ocp', 'bat1_discharge_ocp', 'bat2_charge_ocp'];

const INVERTER_FAULT2 = ['bat2_discharge_ocp', 'bat1_hw_ocp', 'bat2_hw_ocp', 'inv_otp', 'inv_ovp', 'inv_uvp',
	'output_dc_over_current', 'inv_ocp', 'inv_hw_ocp', 'output_dc_over_voltage', 'output_short',
	'output_overload', 'apu_uvp', 'bat_relay_fault', 'dc_input_disturbance', 'grid_disturbance',
	'gird_unbalance', 'freq_jitter', 'grid_overcurrent', 'grid_current_track_fault', 'backup_ovp',
	'dc_bus_unbalancevolt', 'dc_bus_undervolt', 'dc_bus_unbalancevolt2', 'igbt_over_current',
	'grid_disturbance2', 'afci_check_protect', 'grid_current_sampling_abnormal', 'dsp_selfcheck',
	'grid_short_time_over_current', 'bat_overvolt_hardware_fault', 'zero_ground_fault'];

// Note 27
const INVERTER_FAULT_EXT1 = ['ac_hct_check_failure', 'dci_consistency_failure', 'gfci_consistency_failure',
	'relay_device_failure', 'ac_hct_failure', 'gournd_i_failure', 'utility_phase_failure', 'utility_loss',
	'internal_fan_failure', 'fac_consistency_failure', 'vac_consitency_failure', 'phase_angle_failure',
	'dsp_communication_failure', 'eeprom_rw_failure', 'vac_failure', 'fac_failure', 'external_fan_failure',
	'afci_device_failure', 'bus_soft_timeout', 'dc_bus_short', 'inv_soft_timeout', 'grid_load_reverse',
	'lpe_reverse', 'ems_sci', 'ems_can', 'sps_12v_ref', '1p5v_ref', '0p5v_ref', 'ntc_loss', 'inv_hct',
	'load_ct', 'pv1_ct'];

const INVERTER_FAULT_EXT2 = ['pv2_ct', 'bat1_ct', 'bat2_ct', 'bypass_rly', 'load_rly', 'npe_rly', 'dci',
	'watchdog', 'inv_open_loop', 'sw_consistency', 'n_n_reverse_lost', 'ini_fault', 'dsp_b_fault',
	'inverter_circuit_abnormal', 'boost_circuit_abnormal', 'data_storage_error', 'para_can',
	'para_synsignal_wrong', 'para_sw_diff', 'para_module_wrong', 'para_negative_power', 'para_multi_master',
	'para_turnon_wrong', 'hw_ver_diff', 'bus_unbalance', 'inv_line_short'];

// Note 32
const INVERTER_WARNING1 = ['bat_over_voltage_alarm', 'bat_under_voltage_alarm', 'output_overload_alarm',
	'abnormal_temperature_sensor', 'dc_power_alarm', 'battery_stops_running_alarm', 'over_temperature_alarm',
	'pv_volt_high_alarm', 'bat_open_alarm', 'bat_reverse_alarm', 'bus_over_alarm', 'grid_loss_alarm',
	'grid_volt_alarm', 'grid_freq_alarm', '10min_grid_volt_alarm', 'grid_volt_inst_over', 'pe_loss_alarm',
	'ln_reverse', 'low_temper_alarm', 'gfci_alarm', 'iso_alarm', 'dci_alarm', 'dcv_alarm', 'island_alarm',
	'fan_abnormal_alarm', 'n_loss_alarm', 'ems_sci_alarm', 'ems_can_alarm', 'flashid_alarm',
	'read_flash_alarm', 'write_flash_alarm', 'machine_type_alarm'];

const INVERTER_WARNING2 = ['inv_volt_low_alarm', 'inv_over_curr_sw_alarm', 'inv_over_curr_hw_alarm',
	'bst_over_curr_sw_alarm', 'bst_over_curr_hw_alarm', 'buck_bst_over_curr_sw_alarm',
	'buck_bst_over_curr_hw_alarm', 'bus_under', 'no_pv_input_alarm', 'input_power_limit_alarm',
	'output_power_limit_alarm', 'reduce_pby_over_freq_alarm', 'reduce_pby_over_volt_alarm',
	'reduce_pby_over_temp_alarm', 'hvrt_alarm', 'lvrt_alarm', 'ntc_fail_alarm', 'grid_waveform_abnormal_alarm',
	'eps_capacitance_decrease', 'para_alarm', 'para_error_location', 'para_avg_overload',
	'para_module_addr_same', 'para_online_enter_fail', 'para_unbalance_power', 'para_turnon_inconsistent',
	'grid_backup_n_lost', 'bat_num_abnormal', 'grid_phase_order_fault', 'dcv_sample_abnormal',
	'blackbox_flash_fault', 'rtc_fault'];

// --------------------------------------------------------------- helpers ----
function reader(values, start) {
	const has = (a, n) => a - start >= 0 && a - start + (n || 1) <= values.length;
	const reg = (a) => {
		const v = values[a - start];
		if (v === undefined) throw new RangeError(`Register 0x${a.toString(16)} not in block`);
		return v & 0xFFFF;
	};
	return {
		has,
		u16: reg,
		s16: (a) => { const v = reg(a); return v & 0x8000 ? v - 0x10000 : v; },
		u32: (a) => ((reg(a) << 16) | reg(a + 1)) >>> 0,
		s32: (a) => (reg(a) << 16) | reg(a + 1),
		ascii: (a, n) => {
			let s = '';
			for (let i = 0; i < n; i++) {
				const v = reg(a + i);
				s += String.fromCharCode((v >> 8) & 0xFF, v & 0xFF);
			}
			// strip NUL and non-printable characters (unused registers often contain 0x00 or 0xFF)
			return s.replace(/[^\x20-\x7E]/g, '').trim();
		}
	};
}

const round = (v, d) => { const f = Math.pow(10, d); return Math.round(v * f) / f; };

/** returns { raw, hex, active: [{ bit, text }] } */
function bits(value, table) {
	const active = [];
	for (let b = 0; b < 32; b++) {
		if ((value >>> b) & 1) active.push({ bit: b, text: (table && table[b]) || `bit ${b}` });
	}
	return { raw: value, hex: '0x' + value.toString(16).toUpperCase().padStart(8, '0'), active };
}

const hm = (h, m) => String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');

// -------------------------------------------------------------- decoders ----
function decodeMeter(values, S) {
	const r = reader(values, S); // 0x0010 (grid) or 0x0090 (PV meter), same layout
	const d = {
		totalEnergyFeedToGrid: round(r.u32(S + 0) * 0.01, 2), // kWh
		totalEnergyConsumeFromGrid: round(r.u32(S + 2) * 0.01, 2), // kWh
		voltage: [r.u16(S + 4), r.u16(S + 5), r.u16(S + 6)], // V
		current: [round(r.s16(S + 7) * 0.1, 1), round(r.s16(S + 8) * 0.1, 1), round(r.s16(S + 9) * 0.1, 1)],
		frequency: round(r.u16(S + 10) * 0.01, 2),
		activePower: [r.s32(S + 11), r.s32(S + 13), r.s32(S + 15)],
		totalActivePower: r.s32(S + 17),
		reactivePower: [r.s32(S + 19), r.s32(S + 21), r.s32(S + 23)],
		totalReactivePower: r.s32(S + 25),
		apparentPower: [r.s32(S + 27), r.s32(S + 29), r.s32(S + 31)],
		totalApparentPower: r.s32(S + 33),
		powerFactor: [round(r.s16(S + 35) * 0.01, 2), round(r.s16(S + 36) * 0.01, 2), round(r.s16(S + 37) * 0.01, 2)],
		totalPowerFactor: round(r.s16(S + 38) * 0.01, 2)
	};
	// per-phase energy counters (0x0037..0x0042, grid meter only, newer firmware)
	if (S === 0x0010 && r.has(0x0037, 12)) {
		d.energyConsumeFromGridPhase = [0x0037, 0x003B, 0x003F].map((a) => round(r.s32(a) * 0.01, 2)); // kWh
		d.energyFeedToGridPhase = [0x0039, 0x003D, 0x0041].map((a) => round(r.s32(a) * 0.01, 2)); // kWh
	}
	return d;
}

function decodeBattery(values, platform) {
	const r = reader(values, 0x0100);
	const status = r.u16(0x0103);
	const relay = r.u16(0x0104);
	const type = r.u16(0x011A);
	const faultTable = BATTERY_FAULT[platform] || BATTERY_FAULT['EMS3.x'];
	const warnTable = BATTERY_WARNING[platform] || BATTERY_WARNING['EMS3.x'];
	const faults = [];
	const warnings = [];
	for (let i = 0; i < 6; i++) faults.push(r.u32(0x0131 + i * 2));
	for (let i = 0; i < 6; i++) warnings.push(r.u32(0x013D + i * 2));
	return {
		voltage: round(r.u16(0x0100) * 0.1, 1),
		current: round(r.s16(0x0101) * 0.1, 1),
		soc: round(r.u16(0x0102) * 0.1, 1),
		status: { raw: status, charge: (status >> 8) & 0xFF, discharge: status & 0xFF },
		relayStatus: { raw: relay, text: RELAY_STATUS[relay] || 'unknown' },
		minCellVoltage: { value: round(r.u16(0x0107) * 0.001, 3), pack: r.u16(0x0105), cell: r.u16(0x0106) },
		maxCellVoltage: { value: round(r.u16(0x010A) * 0.001, 3), pack: r.u16(0x0108), cell: r.u16(0x0109) },
		cellVoltageSpread: round((r.u16(0x010A) - r.u16(0x0107)) * 0.001, 3),
		minCellTemperature: { value: round(r.s16(0x010D) * 0.1, 1), pack: r.u16(0x010B), cell: r.u16(0x010C) },
		maxCellTemperature: { value: round(r.s16(0x0110) * 0.1, 1), pack: r.u16(0x010E), cell: r.u16(0x010F) },
		maxChargeCurrent: round(r.u16(0x0111) * 0.1, 1),
		maxDischargeCurrent: round(r.u16(0x0112) * 0.1, 1),
		chargeCutoffVoltage: round(r.u16(0x0113) * 0.1, 1),
		dischargeCutoffVoltage: round(r.u16(0x0114) * 0.1, 1),
		bmuSoftwareVersion: r.u16(0x0115),
		lmuSoftwareVersion: r.u16(0x0116),
		isoSoftwareVersion: r.u16(0x0117),
		moduleCount: r.u16(0x0118),
		capacity: round(r.u16(0x0119) * 0.1, 1), // kWh
		type: { raw: type, text: BATTERY_TYPE[type] || 'unknown' },
		soh: round(r.u16(0x011B) * 0.1, 1),
		warning: bits(r.u32(0x011C), warnTable),
		fault: bits(r.u32(0x011E), faultTable),
		chargeEnergy: round(r.u32(0x0120) * 0.1, 1), // kWh
		dischargeEnergy: round(r.u32(0x0122) * 0.1, 1), // kWh
		energyChargeFromGrid: round(r.u32(0x0124) * 0.1, 1), // kWh
		power: r.s16(0x0126), // W, - charge / + discharge
		remainingTime: r.u16(0x0127), // min
		implementationChargeSoc: round(r.u16(0x0128) * 0.1, 1),
		implementationDischargeSoc: round(r.u16(0x0129) * 0.1, 1),
		remainingChargeSoc: round(r.u16(0x012A) * 0.1, 1),
		remainingDischargeSoc: round(r.u16(0x012B) * 0.1, 1),
		maxChargePower: r.u16(0x012C), // W
		maxDischargePower: r.u16(0x012D), // W
		mosControl: r.u16(0x012E),
		socCalibration: r.u16(0x012F),
		singleCutErrorCode: r.u16(0x0130),
		faults, // fault1..6 (raw uint32, no bit table in the documentation)
		warnings // warning1..6
	};
}

/** battery serial numbers 0x0150..0x016D, 6 × 10 characters; empty slots are left out */
function decodeBatteryInfo(values) {
	const r = reader(values, 0x0150);
	const serialNumbers = [];
	for (let i = 0; i < 6; i++) {
		const sn = r.ascii(0x0150 + i * 5, 5);
		if (sn) serialNumbers.push(sn);
	}
	return { serialNumbers };
}

function decodeInverter(values) {
	const r = reader(values, 0x0400);
	const pv = [];
	for (let i = 0; i < 6; i++) {
		const b = 0x041D + i * 4;
		pv.push({ voltage: round(r.u16(b) * 0.1, 1), current: round(r.u16(b + 1) * 0.1, 1), power: r.u32(b + 2) });
	}
	const workMode = r.u16(0x0440);
	const w1 = r.u32(0x0436), w2 = r.u32(0x0438);
	const d = {
		voltage: [0, 1, 2].map((i) => round(r.u16(0x0400 + i) * 0.1, 1)),
		current: [0, 1, 2].map((i) => round(r.s16(0x0403 + i) * 0.1, 1)),
		power: [r.s32(0x0406), r.s32(0x0408), r.s32(0x040A)],
		powerTotal: r.s32(0x040C),
		backup: {
			voltage: [0, 1, 2].map((i) => round(r.u16(0x040E + i) * 0.1, 1)),
			current: [0, 1, 2].map((i) => round(r.u16(0x0411 + i) * 0.1, 1)),
			power: [r.u32(0x0414), r.u32(0x0416), r.u32(0x0418)],
			powerTotal: r.u32(0x041A),
			frequency: round(r.u16(0x0449) * 0.01, 2)
		},
		gridFrequency: round(r.u16(0x041C) * 0.01, 2),
		pv,
		pvPowerTotal: pv.reduce((s, p) => s + p.power, 0),
		temperature: round(r.u16(0x0435) * 0.1, 1),
		warning1: w1,
		warning2: w2,
		warningBits: { warning1: bits(w1, INVERTER_WARNING1), warning2: bits(w2, INVERTER_WARNING2) },
		fault1: bits(r.u32(0x043A), INVERTER_FAULT1),
		fault2: bits(r.u32(0x043C), INVERTER_FAULT2),
		totalPvEnergy: round(r.u32(0x043E) * 0.1, 1), // kWh
		workMode: { raw: workMode, text: WORK_MODE[workMode] || 'unknown' },
		batteryVoltage: r.u16(0x0441), // 1 V/bit
		batteryCurrent: round(r.u16(0x0442) * 0.1, 1),
		batteryPower: r.s16(0x0443),
		totalReactivePower: r.s32(0x0444),
		totalApparentPower: r.s32(0x0446),
		frequency: round(r.u16(0x0448) * 0.01, 2),
		powerFactor: round(r.s16(0x044A) * 0.01, 2),
		faultExtend1: bits(r.u32(0x044B), INVERTER_FAULT_EXT1),
		faultExtend2: bits(r.u32(0x044D), INVERTER_FAULT_EXT2),
		faultExtend3: r.u32(0x044F),
		faultExtend4: r.u32(0x0451)
	};
	// PV total power register (0x0453, newer firmware); pvPowerTotal stays the sum of PV1..PV6
	if (r.has(0x0453, 2)) d.pvPowerTotalRegister = r.u32(0x0453);
	return d;
}

function decodeInverterInfo(values) {
	const r = reader(values, 0x0640);
	const d = {
		masterSoftwareVersion: r.ascii(0x0640, 5),
		slaveSoftwareVersion: r.ascii(0x0645, 5),
		serialNumber: r.ascii(0x064A, 10)
	};
	if (r.has(0x0654, 5)) d.armSoftwareVersion = r.ascii(0x0654, 5);
	return d;
}

function decodeSystemInfo(values) {
	const r = reader(values, 0x0740);
	const ym = r.u16(0x0740), dh = r.u16(0x0741), ms = r.u16(0x0742);
	const vh = r.u16(0x074B), vm = r.u16(0x074C), vl = r.u16(0x074D);
	const d = {
		systemTime: {
			year: 2000 + (ym >> 8), month: ym & 0xFF, day: dh >> 8, hour: dh & 0xFF, minute: ms >> 8, second: ms & 0xFF
		},
		emsSerialNumber: r.ascii(0x0743, 8),
		emsVersion: { high: vh, middle: vm, low: vl, text: `${vh}.${vm}.${vl}` },
		protocolVersion: r.u16(0x074E)
	};
	if (r.has(0x074F, 4)) {
		const suffix = r.ascii(0x074F, 4);
		d.emsVersion.suffix = suffix;
		if (suffix) d.emsVersion.text += suffix.startsWith('-') || suffix.startsWith('.') ? suffix : `-${suffix}`;
	}
	if (r.has(0x0753, 6)) d.wifiSerialNumber = r.ascii(0x0753, 6);
	return d;
}

function decodeSystemConfig(values) {
	const r = reader(values, 0x0800);
	const ip = (a) => { const h = r.u16(a), l = r.u16(a + 1); return [h >> 8, h & 0xFF, l >> 8, l & 0xFF].join('.'); };
	const mode = r.u16(0x0805), ct = r.u16(0x0806);
	return {
		maxFeedIntoGridPercent: r.u16(0x0800),
		pvCapacityStorage: r.u32(0x0801), // W
		pvCapacityGridInverter: r.u32(0x0803), // W
		systemMode: { raw: mode, text: SYSTEM_MODE[mode] || 'unknown' },
		meterCtSelect: { raw: ct, text: METER_CT[ct] || 'unknown' },
		batteryReady: r.u16(0x0807),
		ipMethod: r.u16(0x0808) ? 'STATIC' : 'DHCP',
		localIp: ip(0x0809),
		subnetMask: ip(0x080B),
		gateway: ip(0x080D),
		modbusAddress: r.u16(0x080F),
		modbusBaudRate: r.u16(0x0810),
		threePhaseUnbalance: r.u16(0x0811)
	};
}

function decodeTimePeriod(values, socScale) {
	const r = reader(values, 0x084F);
	const s = socScale || 0.1;
	const flag = r.u16(0x084F);
	return {
		flag: { raw: flag, text: TIME_PERIOD_FLAG[flag] || 'unknown' },
		upsReserveSoc: round(r.u16(0x0850) * s, 1),
		chargeCutSoc: round(r.u16(0x0855) * s, 1),
		discharge1: { start: hm(r.u16(0x0851), r.u16(0x085A)), stop: hm(r.u16(0x0852), r.u16(0x085B)) },
		discharge2: { start: hm(r.u16(0x0853), r.u16(0x085C)), stop: hm(r.u16(0x0854), r.u16(0x085D)) },
		charge1: { start: hm(r.u16(0x0856), r.u16(0x085E)), stop: hm(r.u16(0x0857), r.u16(0x085F)) },
		charge2: { start: hm(r.u16(0x0858), r.u16(0x0860)), stop: hm(r.u16(0x0859), r.u16(0x0861)) },
		raw: values.slice()
	};
}

function decodeDispatch(values) {
	const r = reader(values, 0x0880);
	const mode = r.u16(0x0885);
	const d = {
		active: r.u16(0x0880) === 1,
		activePower: r.s32(0x0881) - 32000, // W, + discharge / - charge
		reactivePower: r.s32(0x0883) - 32000, // var
		mode: { raw: mode, text: DISPATCH_MODE[mode] || 'unknown' },
		soc: round(r.u16(0x0886) * 0.4, 1), // %
		time: r.u32(0x0887) // s
	};
	if (r.has(0x0889, 2)) {
		const pvSwitch = r.u16(0x088A);
		d.para7 = r.u16(0x0889); // aging/test energy flow (Note 29, Tab 2)
		d.pvSwitch = { raw: pvSwitch, text: DISPATCH_PV_SWITCH[pvSwitch] || 'not set' };
	}
	return d;
}

function decodeSystemRun(values) {
	const r = reader(values, 0x08D0);
	return {
		pvInverterEnergy: round(r.u32(0x08D0) * 0.1, 1), // kWh
		systemTotalPvEnergy: round(r.u32(0x08D2) * 0.1, 1), // kWh
		systemFault: bits(r.u32(0x08D4), SYSTEM_FAULT)
	};
}

function decodeBlock(name, values, opts) {
	opts = opts || {};
	switch (name) {
		case 'grid': return decodeMeter(values, 0x0010);
		case 'pvMeter': return decodeMeter(values, 0x0090);
		case 'battery': return decodeBattery(values, opts.platform);
		case 'batteryInfo': return decodeBatteryInfo(values);
		case 'inverter': return decodeInverter(values);
		case 'inverterInfo': return decodeInverterInfo(values);
		case 'systemInfo': return decodeSystemInfo(values);
		case 'systemConfig': return decodeSystemConfig(values);
		case 'timePeriod': return decodeTimePeriod(values, opts.socScale);
		case 'dispatch': return decodeDispatch(values);
		case 'systemRun': return decodeSystemRun(values);
		default: throw new Error(`Unknown block ${name}`);
	}
}

module.exports = { BLOCKS, WORK_MODE, BATTERY_TYPE, DISPATCH_MODE, SYSTEM_FAULT, reader, bits, decodeBlock, round };
