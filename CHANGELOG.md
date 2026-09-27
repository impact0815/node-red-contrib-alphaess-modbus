# Changelog

## 0.1.0 – unreleased

- First version
- Modbus TCP client without external dependencies
- Blocks: grid meter, PV meter, battery, inverter, system running data, system config, time period control, dispatch, device info
- Staggered polling: fast blocks every interval, slow blocks every "slow interval", device info at start and daily
- Derived values: consumption, autarky, self-consumption rate, daily energy (since local midnight) and previous day
- Alarm output (on change) and stale-data detection per block
- Direct MQTT publishing through an existing Node-RED MQTT broker config
- Optional control (disabled by default): dispatch, feed-in limit, time periods
