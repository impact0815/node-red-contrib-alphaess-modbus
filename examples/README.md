# Examples

Importable examples for [`@impact0815/node-red-contrib-alphaess-modbus`](https://github.com/impact0815/node-red-contrib-alphaess-modbus).

In Node-RED, use **Menu → Import → File** or copy the JSON to the clipboard and use **Menu → Import → Clipboard**.

## Available examples

### `alphaess-modbus-example.json`

Basic example flow for the AlphaESS Modbus node.

Use this as the starting point for reading local Alpha ESS data via Modbus TCP and inspecting the node outputs.

### `alphaess-dashboard-flowfuse.json`

Complete bilingual (EN/DE) energy dashboard for **FlowFuse Dashboard 2.0**.

The dashboard visualizes live PV production, home consumption, grid import/export, battery state, energy flow, PV strings, grid phases, 24-hour history, daily energy balance, system health and guarded controls.

If you already use FlowFuse Dashboard 2.0 in the same Node-RED instance, keep only one `ui-base` and assign the imported AlphaESS page/group to your existing dashboard.

### `07-pv-string-diagnostics-flowfuse.json`

Optional add-on for the FlowFuse Dashboard 2.0 example. It compares two PV strings even when different DC capacities are installed on the two MPPT inputs.

The comparison normalizes each string by its configured installed Wp instead of comparing raw watts directly. This makes a configuration such as the following comparable:

- PV1: 10 × 405 Wp = 4.05 kWp
- PV2: 8 × 405 Wp = 3.24 kWp
- Expected power ratio under comparable conditions: 1.25 : 1

The widget shows current power, installed capacity, specific output, voltage and current for both strings. It also shows the expected ratio, measured ratio, normalized deviation and an assessment of whether one string is relatively weak.

To reduce false warnings from short cloud, shade or MPPT effects, evaluation is performed only above a configurable minimum PV power and is smoothed across several qualified samples.

Configuration is editable in the dashboard and can store:

- string names
- panel count per string
- Wp per panel
- minimum combined PV power for evaluation
- warning threshold
- critical threshold
- smoothing sample count

The configuration is stored in the flow context key `alphaPvStringConfig`, using the `file` context store when available and falling back to the default store.

See [`07-pv-string-diagnostics-README.md`](07-pv-string-diagnostics-README.md) for setup details and the comparison method.

## Notes

- The examples are community examples and are not required for the runtime node.
- Write access in the AlphaESS node remains disabled by default. Dashboard controls require **Allow write access** to be enabled deliberately.
- The PV string assessment is a plausibility indicator, not an electrical fault diagnosis. Different orientation, tilt, shading, temperature and module tolerance can create legitimate differences between strings.
