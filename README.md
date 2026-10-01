# @impact0815/node-red-contrib-alphaess-modbus

[Deutsche Version → README.de.md](https://github.com/impact0815/node-red-contrib-alphaess-modbus/blob/main/README.de.md)

Local access to **Alpha ESS** storage systems (SMILE series, Storion) via **Modbus TCP**, without the cloud.

- Realtime data of grid meter, PV meter, battery, inverter and system
- Derived values: house consumption, autarky, self-consumption rate
- Daily energy since local midnight, plus the values of the previous day
- Alarms and warnings as plain text, with an output that only fires on change
- Detection of stale data per register block
- Direct MQTT publishing through an existing Node-RED MQTT broker config, no extra MQTT node needed
- Optional control, **disabled by default**: dispatch (charge/discharge), feed-in limit, charge/discharge time periods
- Careful writing: unchanged values are not written, only changed registers are written, optional minimum interval between writes
- Works with current and older EMS firmware (automatic fallback to the older register list)
- Editor and help in **English and German**
- No runtime dependencies

Register addresses and scaling are based on the *AlphaESS Household Modbus Register Parameter List*
(successor of *Register Parameter List V1.1*).

## Disclaimer

> **Use at your own risk. No warranty.**

- This is an independent community project. It is **not affiliated with, endorsed or supported by Alpha ESS**.
  "Alpha ESS", "SMILE" and "Storion" are used only to describe compatibility; trademarks belong to their respective owners.
- The software is provided **"as is", without warranty of any kind**, see [LICENSE](LICENSE) (MIT).
  The authors are not liable for any damage resulting from its use, to the extent permitted by law.
- **Reading** data does not change the system. **Write commands** (dispatch, feed-in limit, time periods) change how the system
  charges, discharges and feeds into the grid. Wrong values can lead to unwanted grid import, a too deep or too shallow discharge,
  a missing backup reserve, or a feed-in that violates the rules of your grid operator, and may affect the manufacturer warranty.
- Write access is disabled by default. Enable it only if you understand the effect of each command; start with short durations
  and check the result in the manufacturer app.
- Register information is based on the manufacturer documentation and on tests with individual systems.
  Your model or firmware may behave differently.

## Installation

Via *Manage palette* in the Node-RED editor (search for `alphaess-modbus`), or in your Node-RED user directory (usually `~/.node-red`):

```
npm install @impact0815/node-red-contrib-alphaess-modbus
```

Then restart Node-RED.

Requirements: Node-RED 3.0 or later, Node.js 18 or later, and Modbus TCP enabled on the Alpha ESS system.

### Docker

With the official `nodered/node-red` image, install into `/data` so the package survives container updates:

```
docker exec -it node-red bash -c "cd /data && npm install @impact0815/node-red-contrib-alphaess-modbus"
docker restart node-red
```

After installing or updating, reload the editor in the browser (F5); otherwise new outputs and settings are not shown.

### Upgrading from the unscoped package (versions before 0.4.0)

Up to 0.3.x the package was installed as `node-red-contrib-alphaess-modbus` (from a local file).
Both packages provide the same node types, so remove the old one first. Your flows and settings are kept:

```
cd ~/.node-red        # Docker: docker exec -it node-red bash -c "cd /data && ..."
npm uninstall node-red-contrib-alphaess-modbus
npm install @impact0815/node-red-contrib-alphaess-modbus
```

## Quick start

1. Add an **AlphaESS Modbus** node and create a connection with the IP address of the system (port 502, unit ID 85).
2. Keep the default blocks and the interval of 15 s. Connect a debug node to output 1 and deploy.
3. After a few seconds the status shows `PV … | Grid … | SOC … | Load …`.
4. Optional: set up a persistent context store for the [daily values](#daily-values) and select an [MQTT](#mqtt) broker.

If the status shows `ECONNREFUSED`, see [Troubleshooting](#troubleshooting).

## Languages

| Part | Language |
|---|---|
| Editor (labels, hints) and help in the sidebar | English or German, following the language setting of the editor (*User settings → Language*, default: browser language) |
| Status texts under the node, log messages, error messages | language of the Node-RED server |
| Data in `msg.payload` (field names, alarm and warning texts) and MQTT topics | always English, so flows work independently of the language |

Other languages can be added under `locales/`, see [CONTRIBUTING.md](CONTRIBUTING.md).

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
The EMS usually accepts only one Modbus TCP connection at a time. Other Modbus clients polling the same system
(including unused `modbus-client` config nodes of other packages) lead to `ECONNREFUSED`.

### Node (`alphaess-modbus`)

| Setting | Default | Description |
|---|---|---|
| Interval | 15 s | polling interval, `0` = only on input |
| Slow blocks | 300 s | interval for system config, time periods and dispatch state |
| Stale after | 180 s | a block counts as stale after this time without a successful read |
| Read blocks | – | select the register blocks to read |
| EMS | EMS 3.5/3.6 | selects the bit tables for battery faults and warnings |
| Add PV meter | off | adds an AC-coupled PV inverter (PV meter) to PV power and daily PV energy, see [PV meter](#pv-meter-ac-coupled-systems) |
| Daily store | default | context store for daily values, selected from the stores configured in `settings.js`; use a persistent store (e.g. `file`) to keep them across restarts, see [Daily values](#daily-values) |
| MQTT broker | – | optional, see [MQTT](#mqtt) |
| Allow write access | off | required for any control command; shows a warning in the editor and logs a notice at start |
| Max. power | – | optional upper limit for dispatch power in W |
| Min. interval | 10 s | minimum time between two actual writes of the same command, `0` = off |
| SOC scale | 0.1 | %/bit for the SOC values of the time period registers, see [Check the SOC scale](#check-the-soc-scale) |

### PV meter (AC-coupled systems)

The block *PV meter* reads a second meter that only exists if an additional, external PV inverter feeds into the house grid
(AC-coupled system). On DC and most hybrid systems all modules are connected to the Alpha ESS inverter and are already included
in the *Inverter* block. The block is therefore off by default: on systems without PV meter it would only return errors
(and a permanent *stale data* alarm) or zeros.

Check `payload.details.systemConfig`:

| Field | PV meter likely | No PV meter |
|---|---|---|
| `systemMode.text` | `AC` or `Hybrid` | `DC` |
| `pvCapacityGridInverter` | > 0 | 0 |
| `meterCtSelect.text` | contains `PV meter` | contains `PV CT` |

If you have one, enable the block *PV meter* and *Add PV meter to PV power / daily PV energy*.
The daily PV energy of the external inverter comes from the block *System running data*, which must stay enabled.

## Outputs

### Output 1 – data

One message per poll cycle and on `read`. The summary keys are the same as in the cloud node
[node-red-contrib-alphaess](https://github.com/dehsgr/node-red-contrib-alphaess), so flows can switch between cloud and local access.

```json
{
  "consumption": 980, "grid": -720, "modules": 4000, "battery": -2300, "soc": 87.3,
  "gridImport": 0, "gridExport": 720, "batteryCharge": 2300, "batteryDischarge": 0,
  "autarky": 100, "selfConsumptionRate": 82,
  "daily": {
    "day": "2026-09-27", "since": "2026-09-27T00:00:05.000Z", "complete": true,
    "pv": 12.4, "gridFeed": 4.1, "gridImport": 1.2, "batteryCharge": 5.0, "batteryDischarge": 3.3,
    "batteryChargeFromGrid": 0, "consumption": 7.8, "selfConsumptionRate": 66.9, "autarky": 84.6
  },
  "yesterday": { "...": "same structure" },
  "alarms": [],
  "warnings": ["Battery: Temperature imbalance"],
  "blocks": { "grid": { "age": 0, "stale": false }, "inverter": { "age": 0, "stale": false } },
  "details": { "grid": {}, "battery": {}, "inverter": {}, "systemRun": {}, "systemConfig": {}, "timePeriod": {}, "dispatch": {} },
  "info": {
    "inverterInfo": { "serialNumber": "...", "armSoftwareVersion": "..." },
    "systemInfo": { "emsSerialNumber": "...", "emsVersion": {}, "wifiSerialNumber": "..." },
    "batteryInfo": { "serialNumbers": ["..."] }
  }
}
```

Sign conventions:

- `grid`: + = import, - = export
- `battery`: + = discharge, - = charge
- `consumption = modules + grid + battery`

Power values are in W and energy values in kWh.

If a block cannot be read, its last value is used until it becomes stale. After that it is removed from `details`, and the derived values that depend on it are left out.
The read errors of the current cycle are in `msg.errors`.

Values that only newer firmware provides are left out on older systems:

| Field | Description |
|---|---|
| `details.grid.energyConsumeFromGridPhase`, `energyFeedToGridPhase` | lifetime energy per phase L1–L3 in kWh |
| `details.inverter.pvPowerTotalRegister` | PV total power as reported by the inverter; `pvPowerTotal` (sum of PV1–PV6) is always present and used for `modules` |
| `details.dispatch.pvSwitch` | PV switch of the dispatch (Note 29) |
| `info.inverterInfo.armSoftwareVersion`, `info.systemInfo.wifiSerialNumber`, `info.batteryInfo.serialNumbers` | device information |

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

Warnings include battery and inverter warnings (as text), and a missing context store for the daily values.

### Output 3 – command response

The answer to every input command except `read`: `readInfo`, `readRaw` and all write commands.
Data messages on output 1 therefore never contain command responses.

| Property | Description |
|---|---|
| `payload` | the affected block, read back after the command (raw registers for `readRaw`) |
| `written` | written frames `[{ "address": "0x0850", "values": [200] }]`, empty if nothing was written |
| `unchanged` | `true` if `feedIn` / `timePeriod` already had the requested values |

All other properties of the input message are kept, so the response can be matched to the request.
Errors (invalid values, write protection, minimum interval) are reported as node errors and can be handled with a *catch* node.

## Daily values

The Alpha ESS system only provides lifetime counters via Modbus. Daily values are therefore calculated as the difference
to the counter values at local midnight (server time zone). These midnight values are kept in the node context.

- `daily.since` shows when counting started.
- `daily.complete` is `true` if counting started within 15 minutes after midnight, i.e. the values cover the whole day.
  It is `false` if Node-RED was not running at midnight, or after a restart during the day without a persistent store.
- If a counter is reset during the day, the value reached so far is kept.

To keep the daily values across restarts, configure a persistent context store in `settings.js` and select it
(here `file`) as *Daily store* in the node. After changing `settings.js`, restart Node-RED and reload the editor, then the store appears in the drop-down:

```js
contextStorage: {
    default: { module: "memory" },
    file:    { module: "localfilesystem" }
},
```

If the selected store does not exist, Node-RED silently uses the default store instead. The node detects this,
logs a warning at start, shows a yellow status and adds a warning to `payload.warnings`.

## MQTT

Select an existing MQTT broker configuration in the node. The node then publishes directly, without an MQTT out node:

| Topic | Payload |
|---|---|
| `<prefix>/consumption`, `/grid`, `/modules`, `/battery`, `/soc` | number |
| `<prefix>/gridImport`, `/gridExport`, `/batteryCharge`, `/batteryDischarge`, `/autarky`, `/selfConsumptionRate` | number |
| `<prefix>/daily/<key>` | number (kWh or %) |
| `<prefix>/daily/complete` | `true` or `false` |
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

The write commands require **Allow write access** – read the [Disclaimer](#disclaimer) first. The response is sent on output 3.

`dispatch`:

- `power` in W: negative = charge, positive = discharge.
- `soc`: target in %. Default is 100 when charging and 10 when discharging.
- `duration` in seconds, default 300. After this time the system returns to normal operation.
- `mode`: default 2 = *State of Charge control*. Allowed: 1–10 and 19 (*No Battery Charge*).
  Test and off-grid modes of the register list (BurnIn, OSW modes) are rejected.

`feedIn`: a feed-in limit may be required by your grid operator – only change it if you are allowed to.

`timePeriod` changes only the given fields.
`flag`: 0 = off, 1 = charge, 2 = discharge, 3 = both.
Before the first write, compare the SOC values that are read back with the settings in the app. If they do not match, adjust *SOC scale*.

Lowering `upsReserveSoc` takes effect immediately: the battery may discharge down to the new value right away.
If that should only happen at a certain time (e.g. the night before a sunny day), send the command at that time.

### Check the SOC scale

The documentation specifies 0.1 %/bit for `upsReserveSoc` and `chargeCutSoc`, but systems exist that use 1 %/bit.
Check before the first `timePeriod` write:

1. Send `{"topic": "readRaw", "payload": {"address": 2128, "count": 1}}` (register 0x0850, UPS reserve SOC).
2. Compare the raw value on output 3 with the reserve set in the app. Reserve 10 % and raw value `10` → set *SOC scale* to `1`.
   Raw value `100` → keep `0.1`.
3. Afterwards `details.timePeriod.upsReserveSoc` must show the same value as the app.

### How writing works

- **Unchanged values are not written.** `feedIn` and `timePeriod` read the current registers first.
  If the requested values are already set, nothing is written and `msg.unchanged` is `true`.
  A flow can therefore send the same setting repeatedly without wearing out the EMS memory.
- **Only changed registers are written.** Each contiguous run of changed registers is written with its own request.
  Settings that were changed in the app between reading and writing are not overwritten.
  Hour and minute of a time slot are separate registers, so changing a time can take two requests.
- **Minimum interval.** A second actual write of the same command within *Min. interval* fails with an error.
  This protects against loops in a flow. Unchanged requests do not count, and `dispatchStop` is never blocked.
- `dispatch` and `dispatchStop` are commands, not settings, and are always written.

The following registers are intentionally **not** writable: safety test, reset/ATE mode, CT calibration, network and Modbus settings,
battery MOS control, SOC calibration, and the dispatch test parameters (0x0889/0x088A).

## Examples

### Send commands from other tabs with feedback

Use a *link call* node in the sending flow and a *link in* node in front of the AlphaESS node.
To return the response, connect **output 3** to a *switch* on `msg._linkSource` with the rule *is not empty*,
followed by a *link out* in mode *Return to calling link node*:

```
[link in] → [AlphaESS Modbus] ─ output 3 → [switch: msg._linkSource is not empty] → [link out: return]
                                                   └ otherwise → [debug]
```

Responses of commands that were not sent via link call (e.g. from an inject node) have no return address and go to the *otherwise* output.
Enable *Allow write access* in the node.

### Reserve SOC depending on the weather forecast

```js
// function node in front of the link call
const sun = Number(global.get("sunhourstomorrow"));
if (!Number.isFinite(sun) || sun < 0) return null;
return { topic: "timePeriod", payload: { upsReserveSoc: sun >= 3 ? 10 : 20 } };
```

The command can be sent as often as needed: if the value is already set, nothing is written and the response has `unchanged: true`.

### Use the values in other flows

```js
// function node behind output 1
global.set("alphaess", msg.payload);
return { payload: msg.payload.consumption };
```

Other tabs can then read e.g. `global.get("alphaess").details.timePeriod.upsReserveSoc`.

### Ignore incomplete days in statistics

```js
// function node behind output 1, once per day
const y = msg.payload.yesterday;
if (!y || !y.complete) return null;
return { payload: y };
```

### Charge from the grid at night for 15 minutes

```json
{ "topic": "dispatch", "payload": { "power": -3000, "soc": 90, "duration": 900 } }
```

Keep `duration` short and repeat the command if needed. If the flow stops, the system returns to normal operation by itself.

## Troubleshooting

| Symptom | Cause and solution |
|---|---|
| `ECONNREFUSED` for all blocks | Another Modbus client is connected; the EMS accepts only one connection. Check for old `modbus-getter`/`modbus-write` nodes, an **unused `modbus-client` config node** (delete it under *Configuration nodes* and deploy with *Full*), and other programs (Home Assistant, ioBroker, evcc). Otherwise check that Modbus TCP is enabled or restart the EMS. |
| `Timeout` / `Connect timeout` | Wrong IP, network or Docker network problem, slow connection. Test with `nc -zv <ip> 502`; increase *Timeout* and *Delay*. |
| `Modbus exception 2` for one block | The system does not support this block (typically *PV meter*). Disable the block. Extended blocks of the newer register list fall back to the older length automatically; the log shows `extended registers not supported`. |
| Permanent alarm `Stale data: <block>` | The block cannot be read; see `payload.blocks.<block>.error`. |
| Daily values restart after every restart, `daily.complete` is `false` | No persistent context store. Configure one in `settings.js` and select it as *Daily store* (yellow status `store "…" missing` if the selected store does not exist). |
| Time period SOC shows 1 instead of 10 | Wrong *SOC scale*, see [Check the SOC scale](#check-the-soc-scale). |
| `Writing is disabled` | Enable *Allow write access*. |
| `write blocked, next write possible in … s` | *Min. interval* protection. Wait, or check the flow for loops. |
| New outputs/settings not visible after an update | Restart Node-RED and reload the editor (F5). |
| Node types registered twice / install conflict after upgrade to 0.4.0 | The old unscoped package is still installed, see [Upgrading](#upgrading-from-the-unscoped-package-versions-before-040). |
| Editor in English although German is expected | Set *User settings → Language* in the editor to *Deutsch* or the browser language to German. |
| Link call runs into a timeout | Output 3 is not connected to the *link out* in return mode, see [Examples](#send-commands-from-other-tabs-with-feedback). |

## Register blocks

| Block | Start | Count (older firmware) | Read |
|---|---|---|---|
| grid | 0x0010 | 51 (39) | every interval |
| pvMeter | 0x0090 | 39 | every interval |
| battery | 0x0100 | 73 | every interval |
| inverter | 0x0400 | 85 (83) | every interval |
| systemRun | 0x08D0 | 6 | every interval |
| systemConfig | 0x0800 | 18 | slow interval |
| timePeriod | 0x084F | 19 | slow interval |
| dispatch | 0x0880 | 11 (9) | slow interval |
| inverterInfo | 0x0640 | 25 (20) | at start, then daily |
| systemInfo | 0x0740 | 25 (15) | at start, then daily |
| batteryInfo | 0x0150 | 30 (–) | at start, then daily |

Blocks with two counts are read with the longer length first. If the system rejects it (Modbus exception 2 or 3),
the node reads the older length from then on. `payload.blocks.<block>.registers` shows the reduced length.
The battery serial numbers are skipped if the system does not provide them.

Not supported: the *Byte Watt* inverter block (0x0500), the HHE MEC system block (0x06FA–0x072B), Echonet (Japan),
frequency dispatch, AUX, generator and PV changer blocks.

## Development

```
npm test                                  # unit and integration tests against the built-in simulator
npm run simulator                         # Modbus TCP simulator on port 5020
node test/mock-server.js 5020 --legacy    # simulator of an older firmware (register list V1.1)
```

For a manual test without a real system, start the simulator and set the connection to `127.0.0.1:5020`.
Contributions and translations: see [CONTRIBUTING.md](CONTRIBUTING.md). Issues: https://github.com/impact0815/node-red-contrib-alphaess-modbus/issues

## License

MIT – see [LICENSE](LICENSE). Provided without warranty, see [Disclaimer](#disclaimer).
