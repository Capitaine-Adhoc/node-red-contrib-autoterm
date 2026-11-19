/* SPDX-License-Identifier: GPL-2.0-or-later */
"use strict";

const PAGE_ADDRESSES = [0, 64, 128, 192];
const PAGE_SIZE = 64;
const FAULT_OFFSETS = [81, 111, 141, 171];

// Seconds -> "354h 57m"
const hm = (s) => `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;

// "55 aa 03" -> [0x55, 0xaa, 0x03]
function hexToBytes(str) {
    return String(str).trim().split(/\s+/).map((h) => parseInt(h, 16));
}

// Decodes the full EEPROM (256-byte Buffer)
function decodeEEPROM(b) {
    if (!Buffer.isBuffer(b) || b.length !== 256) {
        throw new Error('256-byte buffer expected');
    }
    const u8 = (o) => b.readUInt8(o);
    const u16 = (o) => b.readUInt16BE(o);
    const u32 = (o) => b.readUInt32BE(o);

    const faults = FAULT_OFFSETS.map((o) => ({
        code: u8(o),
        repetitions: u8(o + 1),
        stage: u8(o + 2),
        mode: u8(o + 3),
        totalWorkTime: u32(o + 4),
        modeWorkTimeSeconds: u32(o + 8),
        voltageV: u16(o + 12) / 1000,
        frameTemp: u16(o + 14),
        panelTemp: u8(o + 16),
        externalTemp: u8(o + 17), // 127 = probe absent
        boardTemp: u8(o + 18),
        launchAttempts: u8(o + 19),
        flameBreaks: u8(o + 20),
        flameBreakBorder: u16(o + 21),
        setpointTemp: u8(o + 23),
        definedPower: u8(o + 24),
        currentPower: u8(o + 25),
        ventilationAllowed: u8(o + 26),
        ventilationModeNumber: u8(o + 27),
        workBySensor: u8(o + 28),
        lastLine: u8(o + 29),
    }));

    const totalWorkSeconds = u32(24);
    const ventilationSeconds = u32(68);
    const powerSeconds = Array.from({ length: 10 }, (_, i) => u32(28 + 4 * i));

    return {
        code: u16(3),
        series: u16(6),
        totalStarts: u16(13),
        startsWithoutFaults: u16(17),
        startsWithFaults: u16(19),
        firstAttempt: u16(72),
        secondAttempt: u16(74),
        noIgnition: u16(76),
        breakPowerSupply: u16(78),

        totalWorkSeconds,
        totalWork: hm(totalWorkSeconds),
        ventilationSeconds,
        ventilation: hm(ventilationSeconds),
        powerSeconds,
        powerTimes: powerSeconds.map(hm),

        lastFaultColumn: u8(80) + 1, // raw value, 0-indexed
        faults,
    };
}

// Assembles the 4 EEPROM pages received separately.
// add(address, bytes) returns the decoded report once all 4 pages are in, otherwise null.
function createAssembler(maxAgeMs = 10000) {
    let state = { t: 0, pages: {} };

    return {
        add(address, bytes) {
            if (!PAGE_ADDRESSES.includes(address) || bytes.length !== PAGE_SIZE) {
                return null;
            }

            // New read (page 0) or read too old: start over
            if (address === 0 || Date.now() - state.t > maxAgeMs) {
                state = { t: Date.now(), pages: {} };
            }
            state.pages[address] = bytes;

            if (!PAGE_ADDRESSES.every((a) => state.pages[a])) return null;

            const buf = Buffer.from(
                [].concat(...PAGE_ADDRESSES.map((a) => state.pages[a]))
            );
            state = { t: 0, pages: {} };
            return decodeEEPROM(buf);
        },
    };
}

module.exports = { decodeEEPROM, createAssembler, hexToBytes, PAGE_SIZE };