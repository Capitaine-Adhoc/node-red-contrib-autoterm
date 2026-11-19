/* SPDX-License-Identifier: GPL-2.0-or-later */
'use strict';

// CRC-16 Modbus (polynôme 0xA001, valeur initiale 0xFFFF).
// Ce protocole le transmet en big-endian (octet de poids fort d'abord).
function crc16(input) {
  let crc = 0xFFFF;

  for (const value of input) {
    crc ^= Number(value) & 0xFF;

    for (let i = 0; i < 8; i++) {
      crc = (crc & 1) ? ((crc >>> 1) ^ 0xA001) : (crc >>> 1);
    }
  }

  return crc & 0xFFFF;
}

module.exports = { crc16 };
