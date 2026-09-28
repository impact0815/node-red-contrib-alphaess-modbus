# Contributing

Bug reports, register corrections and pull requests are welcome:
https://github.com/impact0815/node-red-contrib-alphaess-modbus/issues

- Run `npm test` before opening a pull request. The tests run against the built-in Modbus simulator, so no real system is needed.
  `node test/mock-server.js 5020 --legacy` simulates an older firmware that only knows the register list V1.1.
- Register addresses and scaling refer to the *AlphaESS Household Modbus Register Parameter List*
  (successor of *Register Parameter List V1.1*). When you correct a register, please mention the source or include raw register
  values from a real system (`readRaw`).
- Registers that were added in the newer list must keep working on older firmware: add them to the end of a block and set
  `minCount` in `lib/registers.js`, or put them into an optional block.
- New write commands have to be added to the whitelist in `lib/commands.js` and must stay behind *Allow write access*.
