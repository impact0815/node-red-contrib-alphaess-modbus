# Contributing

Bug reports, register corrections and pull requests are welcome.

- Run `npm test` before opening a pull request. The tests run against the built-in Modbus simulator, so no real system is needed.
- Register addresses and scaling refer to *AlphaESS Register Parameter List V1.1*. When you correct a register, please mention the source or include raw register values from a real system.
- New write commands have to be added to the whitelist in `lib/commands.js` and must stay behind *Allow write access*.
