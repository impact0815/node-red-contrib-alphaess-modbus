'use strict';
/**
 * Minimal Modbus TCP client (FC03 read holding registers, FC16 write multiple registers).
 * No external dependencies. Requests are serialised (one in flight), because
 * the AlphaESS EMS does not handle parallel requests reliably.
 */
const net = require('net');
const { EventEmitter } = require('events');

const EXCEPTIONS = {
	1: 'Illegal function',
	2: 'Illegal data address',
	3: 'Illegal data value',
	4: 'Slave device failure',
	5: 'Acknowledge',
	6: 'Slave device busy',
	10: 'Gateway path unavailable',
	11: 'Gateway target failed to respond'
};

class ModbusError extends Error {
	constructor(message, code) {
		super(message);
		this.name = 'ModbusError';
		this.code = code;
	}
}

class ModbusTcpClient extends EventEmitter {
	/**
	 * @param {object} opts
	 * @param {string} opts.host
	 * @param {number} [opts.port=502]
	 * @param {number} [opts.unitId=85]
	 * @param {number} [opts.timeout=2000]  ms per request
	 * @param {number} [opts.delay=20]      ms pause between requests
	 */
	constructor(opts) {
		super();
		this.host = opts.host;
		this.port = opts.port || 502;
		this.unitId = opts.unitId === undefined ? 85 : opts.unitId;
		this.timeout = opts.timeout || 2000;
		this.delay = opts.delay === undefined ? 20 : opts.delay;
		this.socket = null;
		this.connecting = null;
		this.buffer = Buffer.alloc(0);
		this.queue = [];
		this.current = null;
		this.tid = 0;
		this.closed = false;
	}

	get connected() {
		return !!(this.socket && !this.socket.destroyed && !this.connecting);
	}

	_connect() {
		if (this.connected) return Promise.resolve();
		if (this.connecting) return this.connecting;
		this.connecting = new Promise((resolve, reject) => {
			const sock = net.createConnection({ host: this.host, port: this.port });
			const timer = setTimeout(() => {
				sock.destroy();
				reject(new ModbusError(`Connect timeout ${this.host}:${this.port}`, 'ETIMEDOUT'));
			}, this.timeout);
			sock.setNoDelay(true);
			sock.once('connect', () => {
				clearTimeout(timer);
				this.socket = sock;
				this.buffer = Buffer.alloc(0);
				this.emit('connect');
				resolve();
			});
			sock.on('data', (d) => this._onData(d));
			sock.on('error', (err) => {
				clearTimeout(timer);
				this.emit('socketError', err);
				reject(err);
			});
			sock.on('close', () => {
				if (this.socket === sock) this.socket = null;
				this.emit('close');
				if (this.current && this.current.sent) this._finish(new ModbusError('Connection closed', 'ECONNRESET'));
			});
		}).finally(() => { this.connecting = null; });
		return this.connecting;
	}

	_onData(data) {
		this.buffer = Buffer.concat([this.buffer, data]);
		while (this.buffer.length >= 7) {
			const frameLen = 6 + this.buffer.readUInt16BE(4);
			if (this.buffer.length < frameLen) return;
			const frame = this.buffer.subarray(0, frameLen);
			this.buffer = this.buffer.subarray(frameLen);
			this._onFrame(frame);
		}
	}

	_onFrame(frame) {
		const cur = this.current;
		if (!cur || frame.length < 9) return;
		if (frame.readUInt16BE(0) !== cur.tid) return; // stale answer of a timed-out request
		const fc = frame[7];
		if (fc & 0x80) {
			const code = frame[8];
			return this._finish(new ModbusError(
				`Modbus exception ${code} (${EXCEPTIONS[code] || 'unknown'}) at 0x${cur.address.toString(16)}`, code));
		}
		if (fc !== cur.fc) return this._finish(new ModbusError(`Unexpected function code ${fc}`, 'EPROTO'));
		if (fc === 3) {
			const byteCount = frame[8];
			const values = [];
			for (let i = 0; i < byteCount / 2; i++) values.push(frame.readUInt16BE(9 + i * 2));
			if (values.length !== cur.count) {
				return this._finish(new ModbusError(`Expected ${cur.count} registers, got ${values.length}`, 'EPROTO'));
			}
			return this._finish(null, values);
		}
		return this._finish(null, { address: frame.readUInt16BE(8), quantity: frame.readUInt16BE(10) });
	}

	_finish(err, result) {
		const cur = this.current;
		if (!cur) return;
		clearTimeout(cur.timer);
		this.current = null;
		if (err) cur.reject(err); else cur.resolve(result);
		setTimeout(() => this._next(), this.delay);
	}

	_enqueue(job) {
		if (this.closed) return Promise.reject(new ModbusError('Client closed', 'ECLOSED'));
		return new Promise((resolve, reject) => {
			this.queue.push(Object.assign(job, { resolve, reject }));
			if (!this.current) this._next();
		});
	}

	async _next() {
		if (this.current || this.queue.length === 0) return;
		const job = this.queue.shift();
		this.current = job;
		try {
			await this._connect();
		} catch (err) {
			if (this.current === job) this.current = null;
			job.reject(err);
			return setTimeout(() => this._next(), this.delay);
		}
		if (this.current !== job) return;
		this.tid = (this.tid + 1) & 0xFFFF;
		job.tid = this.tid;
		const adu = Buffer.alloc(7 + job.pdu.length);
		adu.writeUInt16BE(job.tid, 0);
		adu.writeUInt16BE(0, 2);
		adu.writeUInt16BE(job.pdu.length + 1, 4);
		adu[6] = this.unitId;
		job.pdu.copy(adu, 7);
		job.timer = setTimeout(() => {
			// drop the connection: late answers would otherwise desync the stream
			if (this.socket) this.socket.destroy();
			this._finish(new ModbusError(`Timeout at 0x${job.address.toString(16)}`, 'ETIMEDOUT'));
		}, this.timeout);
		job.sent = true;
		this.socket.write(adu);
	}

	/** FC03 – resolves with an array of uint16 */
	readHoldingRegisters(address, count) {
		if (count < 1 || count > 125) return Promise.reject(new RangeError('count must be 1..125'));
		const pdu = Buffer.alloc(5);
		pdu[0] = 3;
		pdu.writeUInt16BE(address, 1);
		pdu.writeUInt16BE(count, 3);
		return this._enqueue({ fc: 3, address, count, pdu });
	}

	/** FC16 – values: array of uint16 */
	writeRegisters(address, values) {
		if (!Array.isArray(values) || values.length < 1 || values.length > 123) {
			return Promise.reject(new RangeError('values must contain 1..123 registers'));
		}
		const pdu = Buffer.alloc(6 + values.length * 2);
		pdu[0] = 16;
		pdu.writeUInt16BE(address, 1);
		pdu.writeUInt16BE(values.length, 3);
		pdu[5] = values.length * 2;
		values.forEach((v, i) => pdu.writeUInt16BE(v & 0xFFFF, 6 + i * 2));
		return this._enqueue({ fc: 16, address, count: values.length, pdu });
	}

	close() {
		this.closed = true;
		const err = new ModbusError('Client closed', 'ECLOSED');
		this.queue.splice(0).forEach((j) => j.reject(err));
		if (this.current) this._finish(err);
		if (this.socket) this.socket.destroy();
		this.socket = null;
	}
}

module.exports = { ModbusTcpClient, ModbusError };
