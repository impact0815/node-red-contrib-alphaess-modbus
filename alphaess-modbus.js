'use strict';

const { ModbusTcpClient } = require('./lib/modbus-tcp');
const { BLOCKS, decodeBlock } = require('./lib/registers');
const { computeLive, DailyTracker, collectAlarms } = require('./lib/derived');
const { MqttPublisher } = require('./lib/mqtt');
const { isStoreConfigured, getContextStorage } = require('./lib/context-store');
const cmd = require('./lib/commands');

const FAST_BLOCKS = ['grid', 'pvMeter', 'battery', 'inverter', 'systemRun'];
const SLOW_BLOCKS = ['systemConfig', 'timePeriod', 'dispatch'];
const INFO_BLOCKS = ['inverterInfo', 'systemInfo', 'batteryInfo'];
const OPTIONAL_INFO_BLOCKS = ['batteryInfo']; // not available on every firmware
const INFO_REFRESH_MS = 24 * 3600 * 1000;

const bool = (v) => v === true || v === 'true';
const numOr = (v, d) => {
	const n = Number(v);
	return v === '' || v === undefined || v === null || !Number.isFinite(n) ? d : n;
};
const hex = (a) => '0x' + a.toString(16).padStart(4, '0');
/** Modbus exceptions that mean "register range not supported by this firmware" */
const isUnsupported = (err) => err && (err.code === 2 || err.code === 3);

module.exports = function (RED) {

	// ------------------------------------------------------------ config ----
	function AlphaEssModbusConfigNode(config) {
		RED.nodes.createNode(this, config);
		this.host = config.host;
		this.port = numOr(config.port, 502);
		this.unitId = numOr(config.unitId, 85);
		this.client = new ModbusTcpClient({
			host: this.host,
			port: this.port,
			unitId: this.unitId,
			timeout: numOr(config.timeout, 2000),
			delay: numOr(config.delay, 20)
		});
		this.client.on('socketError', (err) => this.debug(`socket error: ${err.message}`));
		this.on('close', (done) => { this.client.close(); done(); });
	}
	RED.nodes.registerType('alphaess-modbus-config', AlphaEssModbusConfigNode);

	// -------------------------------------------------------------- main ----
	function AlphaEssModbusNode(config) {
		RED.nodes.createNode(this, config);
		const node = this;
		const server = RED.nodes.getNode(config.server);
		if (!server) {
			node.status({ fill: 'red', shape: 'ring', text: 'no connection configured' });
			return;
		}
		const client = server.client;

		const interval = Math.max(0, numOr(config.interval, 10));
		const slowInterval = Math.max(interval, numOr(config.slowInterval, 300));
		const staleAfter = Math.max(1, numOr(config.staleAfter, 180));
		const topic = config.topic || 'alphaess/modbus';
		const fast = FAST_BLOCKS.filter((b) => bool(config['block_' + b]));
		const slow = SLOW_BLOCKS.filter((b) => bool(config['block_' + b]));
		const all = fast.concat(slow);
		const readInfo = bool(config.block_info);
		const opts = {
			platform: config.platform || 'EMS3.x',
			includePvMeter: bool(config.includePvMeter),
			socScale: numOr(config.socScale, 0.1)
		};
		const allowWrite = bool(config.allowWrite);
		const maxPower = config.maxPower !== undefined && config.maxPower !== '' ? Number(config.maxPower) : undefined;
		const writeInterval = Math.max(0, numOr(config.writeInterval, 10));

		// ------------------------------------------------ daily store ----
		const store = String(config.contextStore || '').trim() || undefined;
		let storeWarning = null;
		if (!isStoreConfigured(store, getContextStorage(RED))) {
			storeWarning = `Node: context store "${store}" is not configured in settings.js – ` +
				'daily values are not persistent and restart after every Node-RED restart';
			node.warn(storeWarning);
		}
		const ctx = node.context();
		const daily = new DailyTracker({ get: (k) => ctx.get(k, store), set: (k, v) => ctx.set(k, v, store) });
		const mqtt = new MqttPublisher(RED, node, config);

		const cache = {}; // block -> { data, ts, error, errorTs }
		const countFor = {}; // block -> register count after fallback to the older documentation
		const unsupported = new Set(); // optional blocks the system does not provide
		const lastWrite = {}; // command -> timestamp of the last actual write
		let info = null;
		let infoTs = 0;
		let slowTs = 0;
		let busy = false;
		let timer = null;
		let closed = false;
		let cycle = 0;
		let alarmKey = null;

		function store2cache(name, values) {
			const data = decodeBlock(name, values, opts);
			cache[name] = { data, ts: Date.now() };
			return data;
		}

		/**
		 * Reads a block. Blocks that were extended in the newer register list
		 * (minCount) are read with the new length first; if the system rejects
		 * the request, the node falls back to the old length permanently.
		 */
		async function readRaw(name) {
			const b = BLOCKS[name];
			const count = countFor[name] || b.count;
			try {
				return await client.readHoldingRegisters(b.start, count);
			} catch (err) {
				if (!b.minCount || count <= b.minCount || !isUnsupported(err)) throw err;
				countFor[name] = b.minCount;
				node.log(`${name}: extended registers not supported by this system, reading ${b.minCount} ` +
					`instead of ${b.count} registers`);
				return client.readHoldingRegisters(b.start, b.minCount);
			}
		}

		async function readBlock(name) {
			return store2cache(name, await readRaw(name));
		}

		async function readList(names, errors) {
			for (const name of names) {
				try {
					await readBlock(name);
				} catch (err) {
					errors[name] = err.message;
					cache[name] = Object.assign(cache[name] || {}, { error: err.message, errorTs: Date.now() });
				}
			}
		}

		async function refreshInfo() {
			const errors = {};
			for (const name of INFO_BLOCKS) {
				if (unsupported.has(name)) continue;
				try {
					await readBlock(name);
				} catch (err) {
					if (OPTIONAL_INFO_BLOCKS.includes(name) && isUnsupported(err)) {
						unsupported.add(name);
						node.log(`${name}: not supported by this system`);
						continue;
					}
					errors[name] = err.message;
					node.warn(`${name}: ${err.message}`);
				}
			}
			const res = {};
			INFO_BLOCKS.forEach((n) => { if (cache[n] && cache[n].data) res[n] = cache[n].data; });
			if (Object.keys(res).length) {
				info = res;
				infoTs = Date.now();
				mqtt.publish('info', info, true);
			}
			return errors;
		}

		function blockStatus(now) {
			const res = {};
			all.forEach((n) => {
				const c = cache[n];
				if (!c) return;
				const limit = SLOW_BLOCKS.includes(n) ? Math.max(staleAfter, 2 * slowInterval + interval) : staleAfter;
				const age = c.ts ? Math.round((now - c.ts) / 1000) : null;
				const s = { age, stale: age === null ? true : age > limit };
				if (c.error && (!c.ts || c.errorTs >= c.ts)) s.error = c.error;
				if (countFor[n]) s.registers = countFor[n];
				res[n] = s;
			});
			return res;
		}

		function setStatus(p, errors) {
			const errs = Object.keys(errors);
			if (errs.length && errs.length === all.length) {
				node.status({ fill: 'red', shape: 'ring', text: errors[errs[0]] });
				return;
			}
			const parts = [];
			if (p.modules !== undefined) parts.push(`PV ${p.modules}W`);
			if (p.grid !== undefined) parts.push(`Grid ${p.grid}W`);
			if (p.soc !== undefined) parts.push(`SOC ${p.soc}%`);
			if (p.consumption !== undefined) parts.push(`Load ${p.consumption}W`);
			if (storeWarning) parts.push(`store "${store}" missing`);
			node.status({
				fill: p.alarms.length ? 'red' : ((errs.length || storeWarning) ? 'yellow' : 'green'),
				shape: 'dot',
				text: parts.join(' | ') || 'ok'
			});
		}

		async function poll(send, origMsg, force) {
			if (busy) return false;
			busy = true;
			try {
				const start = Date.now();
				if (readInfo && (!info || start - infoTs > INFO_REFRESH_MS)) await refreshInfo();
				const errors = {};
				const names = fast.slice();
				if (slow.length && (force || !slowTs || start - slowTs >= slowInterval * 1000)) {
					names.push(...slow);
					slowTs = start;
				}
				await readList(names, errors);

				const now = Date.now();
				const blocks = blockStatus(now);
				const details = {};
				all.forEach((n) => { if (cache[n] && cache[n].data && !blocks[n].stale) details[n] = cache[n].data; });

				const live = computeLive(details, opts);
				const day = daily.update(details, now, opts);
				const { alarms, warnings } = collectAlarms(details, blocks);
				if (storeWarning) warnings.push(storeWarning);
				const payload = Object.assign(live, {
					daily: day.daily, yesterday: day.yesterday, alarms, warnings, blocks, details
				});
				if (info) payload.info = info;

				const msg = origMsg ? RED.util.cloneMessage(origMsg) : {};
				msg.topic = topic;
				msg.payload = payload;
				msg.timestamp = now;
				msg.cycle = ++cycle;
				msg.duration = now - start;
				if (Object.keys(errors).length) msg.errors = errors; else delete msg.errors;

				let alarmMsg = null;
				const key = alarms.concat(['|'], warnings).join('\n');
				if (key !== alarmKey) {
					alarmKey = key;
					alarmMsg = {
						topic: topic + '/alarm',
						payload: { active: alarms.length > 0, alarms, warnings, timestamp: new Date(now).toISOString() }
					};
				}
				mqtt.publishCycle(payload, alarmMsg && alarmMsg.payload);
				setStatus(payload, errors);
				send([msg, alarmMsg, null]);
				return true;
			} finally {
				busy = false;
			}
		}

		function schedule(delay) {
			if (!interval || closed) return;
			timer = setTimeout(async () => {
				try {
					await poll((m) => node.send(m));
				} catch (err) {
					node.error(err.message);
				}
				schedule(interval * 1000);
			}, delay);
		}

		// ------------------------------------------------------ commands ----
		function requireWrite() {
			if (!allowWrite) throw new Error('Writing is disabled – enable "Allow write access" in the node settings');
		}

		/** minimum interval between two actual writes of the same command */
		function checkRate(command) {
			if (!writeInterval || !lastWrite[command]) return;
			const wait = writeInterval * 1000 - (Date.now() - lastWrite[command]);
			if (wait > 0) {
				throw new Error(`${command}: write blocked, next write possible in ${Math.ceil(wait / 1000)} s ` +
					`(min. interval ${writeInterval} s)`);
			}
		}

		async function writeFrames(command, frames) {
			for (const f of frames) await client.writeRegisters(f.address, f.values);
			lastWrite[command] = Date.now();
			return frames.map((f) => ({ address: hex(f.address), values: f.values }));
		}

		function reply(send, msg, payload, extra) {
			const out = RED.util.cloneMessage(msg);
			out.payload = payload;
			Object.assign(out, extra);
			send([null, null, out]);
		}

		/**
		 * read-modify-write of a setting block: writes only changed registers,
		 * nothing at all if the values are unchanged.
		 */
		async function writeSetting(command, block, build, send, msg) {
			const b = BLOCKS[block];
			const current = await client.readHoldingRegisters(b.start, b.count);
			const next = build(current);
			const frames = cmd.diffFrames(b.start, current, next);
			if (!frames.length) {
				const data = store2cache(block, current);
				reply(send, msg, data, { unchanged: true, written: [] });
				node.status({ fill: 'blue', shape: 'ring', text: `${command}: unchanged` });
				return;
			}
			checkRate(command);
			const written = await writeFrames(command, frames);
			const data = await readBlock(block);
			reply(send, msg, data, { unchanged: false, written });
			node.status({ fill: 'blue', shape: 'dot', text: `${command}: ${frames.reduce((s, f) => s + f.values.length, 0)} register(s) written` });
		}

		node.on('input', async (msg, send, done) => {
			send = send || function () { node.send.apply(node, arguments); };
			done = done || function (err) { if (err) node.error(err, msg); };
			const t = String(msg.topic || 'read');
			try {
				switch (t) {
					case 'read':
					case topic:
						if (!(await poll(send, msg, true))) node.warn('poll already running – request skipped');
						break;
					case 'readInfo': {
						const errors = await refreshInfo();
						reply(send, msg, info, Object.keys(errors).length ? { errors } : {});
						break;
					}
					case 'readRaw': {
						const a = Number(msg.payload && msg.payload.address);
						const c = Number(msg.payload && msg.payload.count) || 1;
						if (!Number.isInteger(a) || a < 0 || a > 0xFFFF) throw new RangeError('payload.address must be 0..65535');
						reply(send, msg, await client.readHoldingRegisters(a, c));
						break;
					}
					case 'dispatch': {
						requireWrite();
						const frame = cmd.encodeDispatch(Object.assign({ maxPower }, msg.payload));
						checkRate('dispatch');
						const written = await writeFrames('dispatch', [frame]);
						reply(send, msg, await readBlock('dispatch'), { written });
						node.status({ fill: 'blue', shape: 'dot', text: `dispatch ${msg.payload.power}W` });
						break;
					}
					case 'dispatchStop': {
						// never rate limited: stopping must always be possible
						requireWrite();
						const written = await writeFrames('dispatchStop', [cmd.encodeDispatchStop()]);
						reply(send, msg, await readBlock('dispatch'), { written });
						node.status({ fill: 'blue', shape: 'ring', text: 'dispatch stopped' });
						break;
					}
					case 'feedIn': {
						requireWrite();
						const p = msg.payload !== null && typeof msg.payload === 'object' ? msg.payload.percent : msg.payload;
						const frame = cmd.encodeFeedIn(p);
						await writeSetting('feedIn', 'systemConfig', (current) => {
							const next = current.slice();
							next[frame.address - BLOCKS.systemConfig.start] = frame.values[0];
							return next;
						}, send, msg);
						break;
					}
					case 'timePeriod':
						requireWrite();
						await writeSetting('timePeriod', 'timePeriod',
							(current) => cmd.encodeTimePeriod(current, msg.payload, opts.socScale).values, send, msg);
						break;
					default:
						throw new Error(`Unknown topic "${t}"`);
				}
				done();
			} catch (err) {
				node.status({ fill: 'red', shape: 'ring', text: err.message });
				done(err);
			}
		});

		node.on('close', (done) => {
			closed = true;
			clearTimeout(timer);
			mqtt.close(done);
		});

		node.status(storeWarning
			? { fill: 'yellow', shape: 'ring', text: `context store "${store}" missing in settings.js` }
			: { fill: 'grey', shape: 'ring', text: interval ? `polling every ${interval}s` : 'manual mode' });
		schedule(1000);
	}
	RED.nodes.registerType('alphaess-modbus', AlphaEssModbusNode);
};
