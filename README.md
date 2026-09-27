# node-red-contrib-alphaess-modbus

Local access to **Alpha ESS** storage systems (SMILE series, Storion) via **Modbus TCP**, without the cloud.

- Realtime data of grid meter, PV meter, battery, inverter and system
- Derived values: house consumption, autarky, self-consumption rate
- Daily energy since local midnight, plus the values of the previous day
- Alarms and warnings as plain text, with an output that only fires on change
- Detection of stale data per register block
- Direct MQTT publishing through an existing Node-RED MQTT broker config, no extra MQTT node needed
- Optional control, **disabled by default**: dispatch (charge/discharge), feed-in limit, charge/discharge time periods
- No runtime dependencies

Register addresses and scaling are based on *AlphaESS Register Parameter List V1.1*.

> This is an independent community project and is not affiliated with Alpha ESS.

## Installation

In your Node-RED user directory (usually `~/.node-red`):

```
npm install node-red-contrib-alphaess-modbus
```

or via *Manage palette* in the Node-RED editor. Then restart Node-RED.

Requirements: Node-RED 3.0 or later, Node.js 18 or later, and Modbus TCP enabled on the Alpha ESS system.

## Configuration

### Connection (`alphaess-modbus-config`)

| Setting | Default | Description |
|---|---|---|
| Host | – | IP address of the system |
| Port | 502 | Modbus TCP port |
| Unit ID | 85 | Modbus slave address (0x55) |
| Timeout | 2000 ms | per request |
| Delay | 20 ms | pause between requests |

All nodes that use the same connection share one TCP connection, and requests are sent one after another.
Avoid other Modbus clients polling the same system at the same time, since not every system copes with several connections in parallel.

### Node (`alphaess-modbus`)

| Setting | Default | Description |
|---|---|---|
| Interval | 15 s | polling interval, `0` = only on input |
| Slow blocks | 300 s | interval for system config, time periods and dispatch state |
| Stale after | 180 s | a block counts as stale after this time without a successful read |
| Read blocks | – | select the register blocks to read |
| EMS | EMS 3.5/3.6 | selects the bit tables for battery faults and warnings |
| Add PV meter | off | adds an AC-coupled PV inverter (PV meter) to PV power and daily PV energy |
| Daily store | default | context store for daily values; use a persistent store (e.g. `file`) to keep them across restarts |
| MQTT broker | – | optional, see [MQTT](#mqtt) |
| Allow write access | off | required for any control command |
| Max. power | – | optional upper limit for dispatch power in W |
| SOC scale | 0.1 | %/bit for the SOC values of the time period registers |

## Outputs

### Output 1 – data

The summary keys are the same as in the cloud node [node-red-contrib-alphaess](https://github.com/dehsgr/node-red-contrib-alphaess), so flows can switch between cloud and local access.

```json
{
  "consumption": 980, "grid": -720, "modules": 4000, "battery": -2300, "soc": 87.3,
  "gridImport": 0, "gridExport": 720, "batteryCharge": 2300, "batteryDischarge": 0,
  "autarky": 100, "selfConsumptionRate": 82,
  "daily": {
    "day": "2026-09-27", "since": "2026-09-27T00:00:05.000Z",
    "pv": 12.4, "gridFeed": 4.1, "gridImport": 1.2, "batteryCharge": 5.0, "batteryDischarge": 3.3,
    "batteryChargeFromGrid": 0, "consumption": 7.8, "selfConsumptionRate": 66.9, "autarky": 84.6
  },
  "yesterday": { "...": "same structure" },
  "alarms": [],
  "warnings": ["Battery: Temperature imbalance"],
  "blocks": { "grid": { "age": 0, "stale": false }, "inverter": { "age": 0, "stale": false } },
  "details": { "grid": {}, "battery": {}, "inverter": {}, "systemRun": {}, "systemConfig": {}, "timePeriod": {}, "dispatch": {} },
  "info": { "inverterInfo": { "serialNumber": "..." }, "systemInfo": { "emsSerialNumber": "...", "emsVersion": {} } }
}
```

Sign conventions:

- `grid`: + = import, - = export
- `battery`: + = discharge, - = charge
- `consumption = modules + grid + battery`

Power values are in W and energy values in kWh.

If a block cannot be read, its last value is used until it becomes stale. After that it is removed from `details`, and the derived values that depend on it are left out.
The read errors of the current cycle are in `msg.errors`.

### Output 2 – alarm

This output is only sent when alarms or warnings change, and once after start:

```json
{ "active": true, "alarms": ["System: Grid_Meter_Lost"], "warnings": [], "timestamp": "..." }
```

Alarms include:

- system faults
- battery faults
- inverter faults (fault1/2 and fault extend)
- inverter work mode *Fault*
- stale blocks

Warnings include battery and inverter warnings.

## Daily values

Daily values are calculated from the lifetime counters as the difference since local midnight (server time zone).
If Node-RED is not running at midnight, the day starts with the first reading after the start. `daily.since` shows the exact start time.
If a counter is reset during the day, the value reached so far is kept.

## MQTT

Select an existing MQTT broker configuration in the node. The node then publishes directly, without an MQTT out node:

| Topic | Payload |
|---|---|
| `<prefix>/consumption`, `/grid`, `/modules`, `/battery`, `/soc` | number |
| `<prefix>/gridImport`, `/gridExport`, `/batteryCharge`, `/batteryDischarge`, `/autarky`, `/selfConsumptionRate` | number |
| `<prefix>/daily/<key>` | number (kWh or %) |
| `<prefix>/status` | `ok` or `alarm` |
| `<prefix>/alarm` | JSON, only on change |
| `<prefix>/info` | JSON, always retained |
| `<prefix>/details/<block>` | JSON, optional |

The default prefix is `alphaess`. QoS and retain can be configured.
The node uses the connection of the Node-RED core `mqtt-broker` config node, which therefore must not be disabled in `settings.js`.

## Input commands (`msg.topic`)

| Topic | Payload | Description |
|---|---|---|
| `read` or empty | – | read all enabled blocks now, including slow blocks |
| `readInfo` | – | re-read device information |
| `readRaw` | `{"address":1024,"count":10}` | raw holding registers, read only |
| `dispatch` | `{"power":-3000,"soc":90,"duration":900,"mode":2}` | start dispatch |
| `dispatchStop` | – | stop dispatch |
| `feedIn` | `70` | max. feed-in in % |
| `timePeriod` | `{"flag":1,"chargeCutSoc":90,"upsReserveSoc":10,"charge1":{"start":"01:00","stop":"05:00"}}` | charge/discharge time periods |

The write commands require **Allow write access**. After each write, the affected block is read back and sent on output 1. The written raw values are in `msg.written`.

`dispatch`:

- `power` in W: negative = charge, positive = discharge.
- `soc`: target in %. Default is 100 when charging and 10 when discharging.
- `duration` in seconds, default 300. After this time the system returns to normal operation.
- `mode`: default 2 = *State of Charge control*.

`timePeriod` reads the current settings first and changes only the given fields.
`flag`: 0 = off, 1 = charge, 2 = discharge, 3 = both.
Before the first write, compare the SOC values that are read back with the settings in the app. If they do not match, adjust *SOC scale*.

The following registers are intentionally **not** writable: safety test, reset/ATE mode, CT calibration, network and Modbus settings, and battery MOS control.

## Register blocks

| Block | Start | Count | Read |
|---|---|---|---|
| grid | 0x0010 | 39 | every interval |
| pvMeter | 0x0090 | 39 | every interval |
| battery | 0x0100 | 73 | every interval |
| inverter | 0x0400 | 83 | every interval |
| systemRun | 0x08D0 | 6 | every interval |
| systemConfig | 0x0800 | 18 | slow interval |
| timePeriod | 0x084F | 19 | slow interval |
| dispatch | 0x0880 | 9 | slow interval |
| inverterInfo | 0x0640 | 20 | at start, then daily |
| systemInfo | 0x0740 | 15 | at start, then daily |

## Development

```
npm test            # unit and integration tests against the built-in simulator
npm run simulator   # Modbus TCP simulator on port 5020
```

For a manual test without a real system, start the simulator and set the connection to `127.0.0.1:5020`.

## License

MIT
