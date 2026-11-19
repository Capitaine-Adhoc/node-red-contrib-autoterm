/* SPDX-License-Identifier: GPL-2.0-or-later */
"use strict";

const MIN_LENGTH = 72;
// Offset between raw_payload and the offsets of the original decoder.
// Adjust if the fields are shifted (see the full frame).
const OFFSET = 0;

const hex = (b) => b.toString(16).padStart(2, '0').toUpperCase();

// Decodes the diag frame (byte array of the command 0x01 payload)
function decodeDiag(bytes) {
    const d = OFFSET ? bytes.slice(OFFSET) : bytes;
    if (d.length < MIN_LENGTH) return null;

    const u16 = (i) => (d[i] << 8) | d[i + 1];
    const u24 = (i) => (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];

    const extRaw = d[24];

    return {
        status1: d[0],
        status2: d[1],

        compteur_s: u24(2),               // ~1 increment/s

        vent_consigne_rpm: d[11] * 60,    // 48 -> 2880
        vent_reel_rpm: d[12] * 60,
        pompe_Hz: u16(13) / 100,          // 0.87 (same as status)

        temp_corps_C: u16(18) - 273,
        temp_ext_C: extRaw === 0x7F ? null : extRaw,
        temp_interne_C: d[25],
        tension_V: u16(26) / 10,

        raw_payload: Array.from(d, hex).join(' '),
    };
}

module.exports = { decodeDiag };