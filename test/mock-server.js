'use strict';
/**
 * Simple AlphaESS Modbus TCP simulator (FC03 / FC16) for local tests.
 *   node test/mock-server.js [port] [--legacy]   (default 5020)
 *
 * opts.failAddress  read requests starting at this address fail with exception 2 (can be changed at runtime)
 * opts.unsupported  list of [from, to] register ranges; read requests touching them fail with exception 2
 *                   (simulates a firmware that only knows the older register list)
 */
const net = require('net');

/** register ranges that were added in the newer register parameter list */
const NEW_RANGES = [
	[0x0037, 0x0042], // grid per-phase energy
	[0x0150, 0x016D], // battery serial numbers
	[0x0453, 0x0454], // PV total power
	[0x0654, 0x0658], // inverter ARM software version
	[0x074F, 0x0758], // EMS version suffix, WiFi SN
	[0x0889, 0x088A] // dispatch para7/para8
];

function createRegisters() {
	const r = new Uint16Array(0x10000);
	const s16 = (a, v) => { r[a] = v & 0xFFFF; };
	const u32 = (a, v) => { r[a] = (v >>> 16) & 0xFFFF; r[a + 1] = v & 0xFFFF; };
	const ascii = (a, n, str) => {
		for (let i = 0; i < n; i++) r[a + i] = ((str.charCodeAt(i * 2) || 0) << 8) | (str.charCodeAt(i * 2 + 1) || 0);
	};
	// grid meter
	u32(0x0010, 123456); u32(0x0012, 654321);
	r[0x0014] = 231; r[0x0015] = 230; r[0x0016] = 232;
	s16(0x0017, -52); s16(0x0018, 13); s16(0x0019, 8); r[0x001A] = 5001;
	u32(0x001B, -1200); u32(0x001D, 300); u32(0x001F, 180); u32(0x0021, -720);
	s16(0x0033, -98); s16(0x0034, 95); s16(0x0035, 97); s16(0x0036, 99);
	u32(0x0037, 200000); u32(0x0039, 41000); u32(0x003B, 230000); u32(0x003D, 42000); u32(0x003F, 224321); u32(0x0041, 40456);
	// battery
	r[0x0100] = 5120; s16(0x0101, -105); r[0x0102] = 873; r[0x0103] = 257; r[0x0104] = 3;
	r[0x0105] = 1; r[0x0106] = 7; r[0x0107] = 3301; r[0x0108] = 1; r[0x0109] = 12; r[0x010A] = 3342;
	s16(0x010D, 215); s16(0x0110, 243); r[0x0111] = 500; r[0x0112] = 500;
	r[0x0118] = 3; r[0x0119] = 101; r[0x011A] = 30; r[0x011B] = 985;
	u32(0x011C, 0x41); u32(0x011E, 0);
	u32(0x0120, 12345); u32(0x0122, 11111); u32(0x0124, 222);
	s16(0x0126, -2300); r[0x0127] = 95; r[0x012C] = 5000; r[0x012D] = 5000;
	ascii(0x0150, 5, 'BAT0000001'); ascii(0x0155, 5, 'BAT0000002'); ascii(0x015A, 5, 'BAT0000003');
	// inverter
	r[0x0400] = 2310; r[0x0401] = 2300; r[0x0402] = 2320;
	s16(0x0403, 45); u32(0x0406, 1000); u32(0x0408, 1000); u32(0x040A, 1000); u32(0x040C, 3000);
	r[0x041C] = 5000;
	r[0x041D] = 3500; r[0x041E] = 60; u32(0x041F, 2100);
	r[0x0421] = 3400; r[0x0422] = 56; u32(0x0423, 1900);
	r[0x0435] = 356; u32(0x043E, 98765); r[0x0440] = 1;
	r[0x0441] = 512; r[0x0442] = 105; s16(0x0443, -2300); r[0x0448] = 5000; s16(0x044A, 100);
	u32(0x0453, 4000);
	// info
	ascii(0x0640, 5, 'V1.23.4'); ascii(0x0645, 5, 'V2.0.1'); ascii(0x064A, 10, 'AL5002021030123');
	ascii(0x0654, 5, 'ARM1.02');
	r[0x0740] = 0x1A09; r[0x0741] = 0x1B14; r[0x0742] = 0x0800;
	ascii(0x0743, 8, 'AL9002012345678'); r[0x074B] = 2; r[0x074C] = 5; r[0x074D] = 18; r[0x074E] = 1;
	ascii(0x074F, 4, 'B'); ascii(0x0753, 6, 'WIFI12345678');
	// system config
	r[0x0800] = 70; u32(0x0801, 9800); r[0x0805] = 2; r[0x0806] = 0; r[0x0807] = 1;
	r[0x0809] = 0xC0A8; r[0x080A] = 0x0454; r[0x080B] = 0xFFFF; r[0x080C] = 0xFF00;
	r[0x080D] = 0xC0A8; r[0x080E] = 0x0401; r[0x080F] = 0x55;
	// time period
	r[0x0850] = 100; r[0x0855] = 1000;
	// dispatch
	u32(0x0881, 32000); u32(0x0883, 32000);
	// system running
	u32(0x08D2, 98765);
	return r;
}

function createServer(regs, opts) {
	opts = opts || {};
	const writeable = (a) => a === 0x0800 || (a >= 0x084F && a <= 0x0861) || (a >= 0x0880 && a <= 0x0888);
	const touchesUnsupported = (addr, qty) => (opts.unsupported || [])
		.some(([from, to]) => addr <= to && addr + qty - 1 >= from);
	return net.createServer((sock) => {
		let buf = Buffer.alloc(0);
		sock.on('data', (d) => {
			buf = Buffer.concat([buf, d]);
			while (buf.length >= 7 && buf.length >= 6 + buf.readUInt16BE(4)) {
				const len = 6 + buf.readUInt16BE(4);
				const f = buf.subarray(0, len);
				buf = buf.subarray(len);
				const tid = f.readUInt16BE(0), unit = f[6], fc = f[7], addr = f.readUInt16BE(8), qty = f.readUInt16BE(10);
				if (opts.onRequest) opts.onRequest({ fc, addr, qty, unit });
				let pdu;
				if (fc === 3) {
					if (opts.failAddress === addr || touchesUnsupported(addr, qty)) {
						pdu = Buffer.from([0x83, 2]);
					} else {
						pdu = Buffer.alloc(2 + qty * 2);
						pdu[0] = 3; pdu[1] = qty * 2;
						for (let i = 0; i < qty; i++) pdu.writeUInt16BE(regs[addr + i], 2 + i * 2);
					}
				} else if (fc === 16) {
					let ok = true;
					for (let i = 0; i < qty; i++) if (!writeable(addr + i)) ok = false;
					if (!ok) {
						pdu = Buffer.from([0x90, 2]);
					} else {
						for (let i = 0; i < qty; i++) regs[addr + i] = f.readUInt16BE(13 + i * 2);
						pdu = Buffer.alloc(5);
						pdu[0] = 16; pdu.writeUInt16BE(addr, 1); pdu.writeUInt16BE(qty, 3);
					}
				} else {
					pdu = Buffer.from([fc | 0x80, 1]);
				}
				const out = Buffer.alloc(7 + pdu.length);
				out.writeUInt16BE(tid, 0); out.writeUInt16BE(0, 2); out.writeUInt16BE(pdu.length + 1, 4); out[6] = unit;
				pdu.copy(out, 7);
				// two chunks to exercise TCP reassembly
				sock.write(out.subarray(0, 5));
				setImmediate(() => { if (!sock.destroyed) sock.write(out.subarray(5)); });
			}
		});
		sock.on('error', () => {});
	});
}

module.exports = { createRegisters, createServer, NEW_RANGES };

if (require.main === module) {
	const port = Number(process.argv[2]) || 5020;
	const legacy = process.argv.includes('--legacy');
	createServer(createRegisters(), {
		unsupported: legacy ? NEW_RANGES : [],
		onRequest: (r) => console.log(`FC${r.fc} addr=0x${r.addr.toString(16)} qty=${r.qty}`)
	}).listen(port, () => console.log(`AlphaESS simulator listening on port ${port}${legacy ? ' (legacy firmware)' : ''}`));
}
