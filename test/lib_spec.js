/* SPDX-License-Identifier: GPL-2.0-or-later */
"use strict";

const assert = require('assert');
const { crc16 } = require('../lib/crc');
const { buildFrame, parseFrame, parseProxyLine } = require('../lib/frame');
const dec = require('../lib/decoders');
const { commandFrame } = require('../lib/commands');

describe('AutoTerm protocol library', () => {

    it('matches known CRC and transmitted big-endian bytes', () => {
        const bytes = [0xAA, 3, 0, 0, 0x0F];
        assert.equal(crc16(bytes), 0x587C);
        assert.deepEqual(buildFrame(0x0F), [0xAA, 3, 0, 0, 0x0F, 0x58, 0x7C]);
    });

    it('builds and parses frames', () => {
        const bytes = buildFrame(0x11, [17]);
        const frame = parseFrame(bytes);
        assert.equal(frame.cmd, 0x11);
        assert.deepEqual(frame.payload, [17]);
        assert.equal(frame.crcValid, true);
    });

    it('parses proxy lines and reports unknown lines', () => {
        const frameLine = parseProxyLine('C: AA 03 00 00 0F 58 7C [CRC OK]');
        assert.equal(frameLine.kind, 'frame');
        assert.equal(frameLine.source, 'C');
        assert.equal(frameLine.frame.cmd, 15);

        assert.equal(parseProxyLine('PROXY READY').kind, 'ready');
    });

    it('decodes status/settings/version/panel temperature and preserves unknowns', () => {
        const data = Array(19).fill(0);
        data[3] = 0xFE;
        data[4] = 0x7F;
        data[6] = 123;
        data[7] = 1;
        data[8] = 17;
        data[9] = 4;
        data[11] = 2;
        data[12] = 3;
        data[13] = 0;
        data[14] = 87;
        data[15] = 0;
        data[16] = 99;

        const status = dec.decodeStatus(data);
        assert.equal(status.temp_interne_C, -2);
        assert.equal(status.temp_externe_C, null);
        assert.equal(status.etat, 'En marche');
        assert.equal(status.pompe_reel_Hz, 0.99);

        const settings = dec.decodeSettings([0, 30, 4, 22, 1, 3]);
        assert.equal(settings.mode, 'Puissance');

        assert.equal(dec.decodeVersion([2, 1, 7, 3, 3]).version, '2.1.7.3');
        assert.equal(dec.decodePanelTemp([19]).temp_panneau_C, 19);
        assert.equal(dec.decodeFrame({ cmd: 0x55, payload: [9] }).unknown, true);
    });

    it('decodes diagnostic summary and helper tables', () => {
        const diag = Array(72).fill(0);
        diag[24] = 127;
        diag[26] = 0;
        diag[27] = 125;
        assert.equal(dec.decodeDiagnostic(diag).tension_V, 12.5);

        assert.equal(dec.stateTable('En marche')['/GenericInput/0/Value'], 2);
        assert.equal(dec.decodeError(0), null);
        assert(dec.decodeError(999).includes('Unknown fault'));
        assert.equal(dec.consumptionLh(1), 0.158);
    });

    it('supports the observed command family, clamp and 4 EEPROM page requests', () => {
        assert.equal(commandFrame({ action: 'stop' })[4], 3);
        assert.equal(commandFrame({ action: 'temp', temp: 2 })[5], 5);
        assert.equal(commandFrame({ action: 'rapport' }).length, 4);
    });
});
