# Changelog

## 0.4.0

### Added
- **English and German**: editor labels, hints, output labels and help texts in `locales/en-US` and `locales/de`;
  status texts, log and error messages are translated as well (language of the Node-RED server).
  Data in `msg.payload` (field names, alarm and warning texts) stays English.
- German README (`README.de.md`)
- Disclaimer in README, README.de.md, editor help (both nodes) and editor (short note in both dialogs)
- Warning in the editor when *Allow write access* is enabled, and a log notice at start
- Test `test/i18n.test.js`: same keys and placeholders in all languages, every used key exists, help complete

### Changed (breaking)
- Package name is now **`@impact0815/node-red-contrib-alphaess-modbus`** (scoped name as required by the Node-RED packaging
  guidelines for new packages). Node types are unchanged, existing flows keep working.
  Uninstall the old package `node-red-contrib-alphaess-modbus` before installing the new one.
- Help texts moved from `alphaess-modbus.html` to `locales/<language>/alphaess-modbus.html`

### Other
- `.gitattributes` enforces LF line endings
- `update-nodered.sh` removes the old unscoped package automatically

## 0.3.1

### Fixed
- Stale detection compares the exact age in milliseconds; before, the age was rounded to seconds first,
  so a block could be reported stale up to 0.5 s too late
- Tests always close simulator and connections, also when an assertion fails (the test run no longer hangs)

## 0.3.0

Based on the newer *AlphaESS Household Modbus Register Parameter List*.

### Added
- Grid meter: lifetime energy per phase (`energyConsumeFromGridPhase`, `energyFeedToGridPhase`, 0x0037–0x0042)
- Inverter: PV total power register (`pvPowerTotalRegister`, 0x0453); `pvPowerTotal` stays the sum of PV1–PV6
- Inverter warnings 1/2 decoded as text (Note 32): `warningBits`, and texts in `payload.warnings`
  instead of hex values; `warning1`/`warning2` stay raw numbers
- Inverter fault extend 1 bits 17–31 and fault extend 2 bits 0–25 decoded as text (Note 27)
- Battery warnings bits 8–12 (Note 28; bit 8 is now *Software versions inconsistent* instead of *No soc calibration*)
- Device info: inverter ARM software version, EMS version suffix, WiFi serial number, battery serial numbers (new block `batteryInfo`)
- Dispatch: PV switch and para7 read back (0x0889/0x088A); dispatch mode texts for 19–25
- Dispatch mode 19 (*No Battery Charge*) can be written; test and off-grid modes (20–25) are rejected

### Changed
- Extended blocks are read with the new length first and fall back automatically to the length of the
  older register list V1.1 if the system rejects the request; `payload.blocks.<block>.registers` shows the reduced length
- Non-printable characters are removed from ASCII values (serial numbers, versions)
- Simulator: option `--legacy` simulates a firmware with the older register list
- Repository links point to github.com/impact0815; CONTRIBUTING refers to the newer register list

## 0.2.3

### Documentation
- Editor help rewritten: quick start, all settings explained, examples for every input command, output descriptions,
  daily values, MQTT topics, link call pattern, troubleshooting
- Connection help: settings, single-connection limit of the EMS, troubleshooting for `ECONNREFUSED`, timeouts and Modbus exceptions
- README: Docker installation, quick start, PV meter guidance, SOC scale check, examples, troubleshooting table

## 0.2.2

### Changed
- *Daily store* is now a drop-down with the context stores configured in `settings.js` instead of a text field.
  A value that is not configured stays selectable and is marked "not configured in settings.js".
  If only the in-memory store exists, the editor shows a hint how to add a persistent store.

## 0.2.1

### Added
- Check of the selected context store ("Daily store"): if it is not configured in `settings.js`,
  the node logs a warning at start, shows a yellow status and adds a warning to `payload.warnings`
  (and once to the alarm output). Before, Node-RED silently fell back to the in-memory store.
- `daily.complete` / `yesterday.complete`: `true` if counting started within 15 minutes after local midnight,
  i.e. the daily values cover the whole day. Also published as `<prefix>/daily/complete`.

## 0.2.0

### Added
- Third output **command response** for `readInfo`, `readRaw` and all write commands
- `feedIn` and `timePeriod` skip the write if the values are already set (`msg.unchanged = true`)
- Only changed registers are written (one request per contiguous run of changed registers)
- Setting **Min. interval** (default 10 s): minimum time between two actual writes of the same command; `dispatchStop` is never blocked

### Changed (breaking)
- Responses to commands are no longer sent on output 1 but on output 3; output 1 only carries poll data
- `msg.written` is now an array of frames `[{ address, values }]` instead of a single object

## 0.1.0

- First version
- Modbus TCP client without external dependencies
- Blocks: grid meter, PV meter, battery, inverter, system running data, system config, time period control, dispatch, device info
- Staggered polling: fast blocks every interval, slow blocks every "slow interval", device info at start and daily
- Derived values: consumption, autarky, self-consumption rate, daily energy (since local midnight) and previous day
- Alarm output (on change) and stale-data detection per block
- Direct MQTT publishing through an existing Node-RED MQTT broker config
- Optional control (disabled by default): dispatch, feed-in limit, time periods
