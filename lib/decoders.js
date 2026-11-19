/* SPDX-License-Identifier: GPL-2.0-or-later */
'use strict';

// ---------------------------------------------------------------------------
// Lookup tables
// ---------------------------------------------------------------------------

// Address values of the "device" byte of a frame
const DEVICE = {
  PANEL: 0x03,
  HEATER: 0x04,
};

const STATES = {
  0: 'Off',
  1: 'Starting',
  4: 'Running',
  5: 'Shutting down',
  6: 'Thermostat standby',
  8: 'Cold ventilation',
};

const MODES = {
  1: 'Heater temperature',
  2: 'Panel temperature',
  3: 'Air temperature',
  4: 'Power',
};

const ERRORS = {
  1: 'Overheating of the heat exchanger',
  2: 'Possible overheating at the intake temperature sensor. Sensor temperature (control unit) is more than 55 degrees.',
  4: 'Faulty temperature sensor in the control unit',
  5: 'Faulty temperature sensor (AIR-2D) or flame indicator',
  6: 'Faulty temperature sensor in the control unit',
  7: 'Overheat sensor - open circuit',
  8: 'Flame failure during operation of the heater.',
  9: 'Faulty glow plug',
  10: 'Electric motor of the air blower does not develop the necessary speed.',
  11: 'Faulty air temperature sensor (intake) only for AIR-8D.',
  12: 'Shut down, overvoltage more than 30V (for 24V) or more than 16V (for 12V).',
  13: 'The heater does not start - two automatic start attempts failed.',
  15: 'Shut down, low voltage, less than 20V (for 24V) or less than 10V (for 12V)',
  16: 'During the purge time, temperature sensor was not cooled down. Time for ventilation was exceeded.',
  17: 'Faulty fuel pump',
  20: 'Heater does not start',
  27: 'Motor does not rotate',
  28: 'Motor rotates. Speed is not regulated.',
  29: 'Flame failure during operation of the heater.',
  30: 'Heater does not start',
  31: 'Overheating of hot air outlet temperature sensor. Only for AIR-8D.',
  32: 'Faulty temperature sensor at air intake.',
  33: 'Heater control is blocked',
  34: 'Wrong component assembly',
  35: 'Flame failure',
  36: 'Flame indicator temperature above normal',
  78: 'Flame failure during operation.',
};

// Fuel volume delivered per 100 pump pulses, in millilitres
const PUMPS = {
  '2D': { ml_per_100_pulses: 4.4 },
  '4D': { ml_per_100_pulses: 6.8 },
};

const DEFAULT_HEATER_TYPE = '2D';

// Commands the panel sends with an empty payload to request a read.
// The heater then answers with the same command.
const READ_REQUESTS = {
  0x0F: 'status',
  0x02: 'settings',
  0x06: 'version',
  0x07: 'diagnostic',
  0x11: 'panel_temp',
};

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

// Byte array -> "00 1e 02 ..."
const hex = (d) => Array.from(d, (b) => b.toString(16).padStart(2, '0')).join(' ');

// 16-bit big-endian integer read at index i
const u16 = (d, i) => (d[i] << 8) | d[i + 1];

// Unsigned byte -> signed integer (-128..127)
const signed = (v) => (v > 127 ? v - 256 : v);

// Round to a given number of decimals
const round = (v, decimals) => {
  const f = Math.pow(10, decimals);
  return Math.round(v * f) / f;
};

// Throws a clear error if the payload is shorter than expected
function requireLength(d, min, label) {
  if (d.length < min) {
    throw new Error(`${label} requires at least ${min} payload bytes`);
  }
}

// ---------------------------------------------------------------------------
// Fuel consumption
// ---------------------------------------------------------------------------

/**
 * Compute fuel consumption in litres per hour from the pump frequency.
 * @param {number} pumpHz      pump frequency in Hz (pulses per second)
 * @param {string} heaterType  "2D" | "4D" (defaults to "2D")
 * @returns {number|null} litres per hour, null if the frequency is invalid
 */
function computeConsumption(pumpHz, heaterType) {
  const pump = PUMPS[heaterType] || PUMPS[DEFAULT_HEATER_TYPE];
  const hz = Number(pumpHz);

  if (!Number.isFinite(hz) || hz < 0) return null;

  const mlPerPulse = pump.ml_per_100_pulses / 100;
  return round((hz * mlPerPulse * 3600) / 1000, 3);
}

// Kept for backward compatibility
function consumptionLh(hz, heaterType) {
  return computeConsumption(hz, heaterType) ?? 0;
}

// ---------------------------------------------------------------------------
// Frame decoders
// ---------------------------------------------------------------------------

// 0x0F: heater status
function decodeStatus(d, heaterType) {
  requireLength(d, 19, 'Status 0x0F');

  const pumpActualHz = u16(d, 15) / 100;

  return {
    state_code: d[9],
    state: STATES[d[9]] || `Unknown ${d[9]}`,
    error_code: d[2],
    error_msg: decodeError(d[2]),  
    voltage_V: d[6] / 10,
    internal_temp_C: signed(d[3]),
    external_temp_C: d[4] === 127 ? null : signed(d[4]),
    body_temp_C: u16(d, 7) - 273,
    fan_setpoint_rpm: d[11] * 60,
    fan_actual_rpm: d[12] * 60,
    pump_setpoint_Hz: u16(d, 13) / 100,
    pump_actual_Hz: pumpActualHz,
    consumption_Lh: computeConsumption(pumpActualHz, heaterType),
    // Bytes whose role is not identified yet
    unknown_0: d[0],
    unknown_1: d[1],
    unknown_5: d[5],
    unknown_7: d[7],
    unknown_10: d[10],
    unknown_17: d[17],
    unknown_18: d[18],
    raw_payload: hex(d),
  };
}

// 0x02: settings
function decodeSettings(d) {
  requireLength(d, 6, 'Settings 0x02');

  return {
    use_work_time_raw: d[0],
    timer_active: d[0] === 0,
    work_time_min: d[1],
    mode_code: d[2],
    mode: MODES[d[2]] || `Unknown ${d[2]}`,
    setpoint_C: d[3],
    ventilation: d[4] === 1 ? 'On' : 'Off',
    power: d[5],
    raw_payload: hex(d),
  };
}

// 0x11: panel temperature
function decodePanelTemp(d) {
  if (d.length !== 1) {
    throw new Error('Panel temperature 0x11 requires exactly 1 payload byte');
  }
  return { panel_temp_C: d[0] };
}

// 0x06: firmware version
function decodeVersion(d) {
  requireLength(d, 5, 'Version 0x06');

  return {
    version: `${d[0]}.${d[1]}.${d[2]}.${d[3]}`,
    blackbox_version: d[4],
    raw_payload: hex(d.slice(0, 5)),
  };
}

// 0x07: detailed diagnostic (72 bytes)
function decodeDiagnostic(d, heaterType) {
  requireLength(d, 72, 'Diagnostic 0x07');

  const u24 = (i) => (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
  const pumpHz = u16(d, 13) / 100;

  return {
    status1: d[0],
    status2: d[1],
    counter_s: u24(2),
    fan_setpoint_rpm: d[11] * 60,
    fan_actual_rpm: d[12] * 60,
    pump_Hz: pumpHz,
    consumption_Lh: computeConsumption(pumpHz, heaterType),
    body_temp_C: u16(d, 18) - 273,
    external_temp_C: d[24] === 127 ? null : d[24],
    internal_temp_C: d[25],
    voltage_V: u16(d, 26) / 10,
    raw_payload: hex(d),
  };
}

// ---------------------------------------------------------------------------
// Dispatch by command
// ---------------------------------------------------------------------------

function decodeFrame(f, heaterType) {
  const d = f.payload;

  // Read request from the panel: empty payload, not actual data
  if (f.device === DEVICE.PANEL && d.length === 0 && READ_REQUESTS[f.cmd]) {
    return { kind: 'request', command: READ_REQUESTS[f.cmd] };
  }

  switch (f.cmd) {
    case 0x0F:
      return decodeStatus(d, heaterType);
    case 0x02:
      return decodeSettings(d);
    case 0x11:
      return decodePanelTemp(d);
    case 0x06:
      return decodeVersion(d);
    case 0x07:
      return d.length >= 72
        ? decodeDiagnostic(d, heaterType)
        : { raw_payload: hex(d), unknown: true };
    case 0x0B:
      return { address: u16(d, 0), raw_payload: hex(d.slice(2)), unknown: true };
    default:
      return { raw_payload: hex(d), unknown: true };
  }
}

// ---------------------------------------------------------------------------
// Helpers for Node-RED outputs
// ---------------------------------------------------------------------------

// Error code -> readable message (null if no error)
function decodeError(code) {
  code = Number(code);
  if (!code) return null;
  return `Error ${code}: ${ERRORS[code] || 'Unknown fault code'}`;
}

// State label -> Victron-style values (/GenericInput/0/...)
function stateTable(label) {
  const table = {
    'Off': 0,
    'Starting': 1,
    'Running': 2,
    'Shutting down': 3,
    'Thermostat standby': 4,
    'Cold ventilation': 5,
  };

  if (!Object.prototype.hasOwnProperty.call(table, label)) {
    return { '/GenericInput/0/Status': 1 };
  }
  return {
    '/GenericInput/0/Value': table[label],
    '/GenericInput/0/Status': 0,
  };
}

// ---------------------------------------------------------------------------
// EEPROM decoding (256 bytes)
// ---------------------------------------------------------------------------

// The 4 fault blocks start at these offsets, 30 bytes each
const FAULT_OFFSETS = [81, 111, 141, 171];

function decodeEeprom(buffer) {
  const b = Buffer.from(buffer);
  if (b.length !== 256) throw new Error('Buffer of 256 bytes required');

  const u8 = (o) => b.readUInt8(o);
  const u16b = (o) => b.readUInt16BE(o);
  const u32 = (o) => b.readUInt32BE(o);

  // Seconds -> "12h 34m"
  const hm = (x) => `${Math.floor(x / 3600)}h ${Math.floor((x % 3600) / 60)}m`;

  const decodeFault = (o) => ({
    code: u8(o),
    repetitions: u8(o + 1),
    stage: u8(o + 2),
    mode: u8(o + 3),
    totalWorkTime: u32(o + 4),
    modeWorkTimeSeconds: u32(o + 8),
    voltageV: u16b(o + 12) / 1000,
    frameTemp: u16b(o + 14),
    panelTemp: u8(o + 16),
    externalTemp: u8(o + 17),
    boardTemp: u8(o + 18),
    launchAttempts: u8(o + 19),
    flameBreaks: u8(o + 20),
    flameBreakBorder: u16b(o + 21),
    setpointTemp: u8(o + 23),
    definedPower: u8(o + 24),
    currentPower: u8(o + 25),
    ventilationAllowed: u8(o + 26),
    ventilationModeNumber: u8(o + 27),
    workBySensor: u8(o + 28),
    lastLine: u8(o + 29),
  });

  const faults = FAULT_OFFSETS.map(decodeFault);

  const totalWorkSeconds = u32(24);
  const ventilationSeconds = u32(68);
  // 10 power levels, 4 bytes each starting at offset 28
  const powerSeconds = Array.from({ length: 10 }, (_, i) => u32(28 + 4 * i));

  return {
    code: u16b(3),
    series: u16b(6),
    totalStarts: u16b(13),
    startsWithoutFaults: u16b(17),
    startsWithFaults: u16b(19),
    firstAttempt: u16b(72),
    secondAttempt: u16b(74),
    noIgnition: u16b(76),
    breakPowerSupply: u16b(78),
    totalWorkSeconds,
    totalWork: hm(totalWorkSeconds),
    ventilationSeconds,
    ventilation: hm(ventilationSeconds),
    powerSeconds,
    powerTimes: powerSeconds.map(hm),
    lastFaultColumn: u8(80) + 1,
    faults,
  };
}

module.exports = {
  DEVICE,
  STATES,
  MODES,
  ERRORS,
  PUMPS,
  DEFAULT_HEATER_TYPE,
  decodeEeprom,
  decodeStatus,
  decodeSettings,
  decodePanelTemp,
  decodeVersion,
  decodeDiagnostic,
  decodeError,
  stateTable,
  computeConsumption,
  consumptionLh,
  decodeFrame,
};