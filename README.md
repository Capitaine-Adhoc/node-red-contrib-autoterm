<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
# node-red-contrib-autoterm

Node-RED support for an Autoterm heater connected through an Arduino Mega USB serial proxy.

The protocol implementation is based on reverse engineering and community efforts; it is not an official protocol specification. Unrecognized bytes, fields, and commands remain raw/unknown rather than being assigned guessed meanings.

## Installation

In your Node-RED user directory:

```sh
npm install node-red-contrib-autoterm
```

Or install from the package directory with `npm install`. Create one **Autoterm serial** configuration and share it among the input/output nodes. Set the serial path (e.g. `/dev/ttyUSB0` or a Windows COM port); baud rate defaults to 115200. The config opens and reconnects automatically.

## Hardware and USB protocol

The expected setup is the heater/controller data connection wired to an Arduino Mega proxy, and the Mega connected to the Node-RED host over USB serial. Check voltage levels, common ground, wiring and the original heater documentation before connecting; do not connect logic pins directly to an incompatible bus. The Arduino emits one LF-terminated line per event, e.g. `H: AA 03 00 00 0F 58 7C [CRC OK]`, or `PROXY READY`, `INJ: ...`, `ERR BUSY`, `ERR CRC`, `ERR HEX`, `ERR LENGTH`, `ERR OVERFLOW`, `[CRC KO]`, or `[BROKEN]`. Injection is an uppercase/lowercase-insensitive hex byte line ending in LF. CRC16 uses Modbus polynomial `0xA001`, initial value `0xFFFF`, over all preceding bytes, then transmitted high byte first. Frame layout: `AA | device | payload_len | type | cmd_id | payload | CRC_hi | CRC_lo`.

The sketch source was not included with the supplied files. `firmware/README.md` records the expected interface; no Arduino sketch is claimed as provided.

## Nodes

* **autoterm-serial** — shared serial path, 115200 default, line parser, reconnect loop, EventEmitter fan-out and serialized writes. A `BUSY` response retries the pending command up to the configured maximum (default 3), then rejects; other proxy errors reject. Serial errors are emitted to listeners.
* **autoterm-in** — receives valid CRC-OK C/H frames, optionally filters source or command IDs. Emits decoded object in `msg.payload`, byte array in `msg.frame`, `msg.source`, `msg.cmd`, `msg.type`, and raw line in `msg.raw`. Status includes fuel consumption estimate and mapped state fields; proxy events/errors are forwarded.
* **autoterm-out** — sends a hex string, byte array, or command object in `msg.payload`.
* **autoterm-command** — accepts `{action,...}` and constructs/sends command frames. `rapport` sends the four observed EEPROM page reads spaced 150 ms apart.

### Observed actions

`init`, `stop`, `status`, `getsettings`, `version`, `diag` (`enable`), `temp` (`temp`, observed in an inject but commented out in the source generator), `fan` (`niveau`), `start` / `set` (`mode`, `consigne`, `vent`, `puissance`), and `rapport`. Values use the original generator's clamping defaults. Note: temperature `0x11` was commented out in the supplied generator, so `temp` is exposed from the observed commented implementation and must be treated as unverified. Fourteen inject nodes were present; their repeated payloads are represented by the supported action commands rather than copied as a separate redundant flow.

## Library and example

`lib/` exports pure-JavaScript CRC, frame, command, and decoder helpers. Import `examples/basic-flow.json` into Node-RED and update the serial port. State labels and fault descriptions follow the supplied flow. The consumption estimate uses the flow's stated TH11 pump assumption (4.4 ml/100 pulses). Diagnostic fields follow supplied offsets; EEPROM pages are joined externally before calling `decodeEeprom` with a 256-byte buffer. Unknown values remain labeled unknown or raw.

## Development

```sh
npm ci
npm test
```

Tests use a simulated line/event source and do not require a physical serial port or heater.

## License

GPL-2.0-or-later; see the complete `LICENSE` file. Contributions are offered under the same license.
