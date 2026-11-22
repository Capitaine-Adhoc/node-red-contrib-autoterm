/* SPDX-License-Identifier: GPL-2.0-or-later */
'use strict';

const { buildFrame } = require('./frame');

// Convert to integer and clamp between min and max (fallback if not numeric)
function clamp(value, min, max, fallback) {
  const n = Number(value);
  const rounded = Math.round(Number.isFinite(n) ? n : fallback);
  return Math.max(min, Math.min(max, rounded));
}

// EEPROM pages read by the "report" action
const EEPROM_PAGES = [0, 64, 128, 192];

// Build the frame (or frames for "report") of a {action, ...} command
function commandFrame(p = {}) {
  let cmd;
  let payload = [];

  switch (p.action) {
    case 'init':
      cmd = 0x04;
      break;

    case 'stop':
      cmd = 0x03;
      break;

    case 'status':
      cmd = 0x0F;
      break;

    case 'getsettings':
      cmd = 0x02;
      break;

    case 'version':
      cmd = 0x06;
      break;

    case 'diag':
      cmd = 0x07;
      payload = [p.enable === true ? 1 : 0];
      break;

    case 'temp':
      cmd = 0x11;
      payload = [clamp(p.temp, 5, 40, 20)];
      break;

    case 'fan':
      cmd = 0x23;
      payload = [0x00, 0x1E, clamp(p.powerlevel, 0, 9, 0)];
      break;

    case 'start':
    case 'set':
      cmd = p.action === 'start' ? 0x01 : 0x02;
      payload = [
        0xFF,
        0xFF,
        clamp(p.mode, 1, 4, 4),
        clamp(p.thermostat, 0, 40, 16),
        clamp(p.vent, 1, 2, 1),
        clamp(p.powerlevel, 0, 9, 3),
      ];
      break;

    case 'report':
      // Four EEPROM reads: 2-byte address + length 0x40
      return EEPROM_PAGES.map((addr) => buildFrame(0x0B, [addr >>> 8, addr & 255, 0x40]));

    default:
      throw new Error(`Unknown Autoterm action: ${p.action}`);
  }

  return buildFrame(cmd, payload);
}

module.exports = { commandFrame, clamp };