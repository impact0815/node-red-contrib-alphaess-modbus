---
name: Bug report
about: Something does not work as expected
labels: bug
---

**Description**
What happened, and what did you expect?

**System**
- Node-RED version:
- Node.js version:
- node-red-contrib-alphaess-modbus version:
- Alpha ESS system (model, EMS version from `payload.info`):

**Output / log**
Relevant part of `msg.payload`, `msg.errors` or the Node-RED log.
Raw registers can be read with `msg.topic = "readRaw"`.

**Flow**
Minimal flow to reproduce (export as JSON, remove IP addresses and credentials).
