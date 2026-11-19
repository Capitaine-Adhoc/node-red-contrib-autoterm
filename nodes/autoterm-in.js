/* SPDX-License-Identifier: GPL-2.0-or-later */
"use strict";

const { decodeFrame, decodeError, stateTable } = require('../lib/decoders');
const { createAssembler, hexToBytes } = require('../lib/eeprom');
const { decodeDiag } = require('../lib/diag');

const CMD_DIAG = 0x01;
const CMD_EEPROM = 0x0B;
const CMD_STATUS = 0x0F;

module.exports = function (RED) {
    function Input(config) {
        RED.nodes.createNode(this, config);
        this.config = RED.nodes.getNode(config.serial);

        if (!this.config) {
            this.error('Autoterm serial configuration is required');
            return;
        }

        const node = this;
        const sourceFilter = (config.source || 'both').toUpperCase();
        const cmdFilter = (config.commands || '')
            .split(/[ ,]+/)
            .filter(Boolean)
            .map((x) => parseInt(x, 0))
            .filter(Number.isFinite);

        // One assembler per node: rebuilds the EEPROM from the 4 pages
        const eeprom = createAssembler();

        // Common message for all decoded frames
        function baseMessage(p, f, payload) {
            return {
                topic: `Autoterm/${f.cmd.toString(16).padStart(2, '0')}`,
                payload,
                frame: f.bytes,
                source: p.source,
                cmd: f.cmd,
                type: f.type,
                device: f.device,
                raw: p.raw,
            };
        }

        // Diag frame: decoded only if the payload is an unknown "raw_payload"
        function handleDiag(p, f, payload) {
            if (typeof payload.raw_payload !== 'string') return false;

            let diag;
            try {
                diag = decodeDiag(hexToBytes(payload.raw_payload));
            } catch (e) {
                node.warn(`Diag: ${e.message}`);
                return true;
            }

            // Frame too short: not diag, let it pass through as-is
            if (!diag) return false;

            const msg = baseMessage(p, f, diag);
            msg.topic = 'Autoterm/diag';
            node.send(msg);
            return true;
        }

        // EEPROM page: accumulate, and only emit the full report
        function handleEeprom(p, f, payload) {
            if (typeof payload.address !== 'number' || typeof payload.raw_payload !== 'string') {
                return false; // unexpected format: let it pass through as-is
            }

            let report;
            try {
                report = eeprom.add(payload.address, hexToBytes(payload.raw_payload));
            } catch (e) {
                node.warn(`EEPROM: ${e.message}`);
                return true;
            }

            // Intermediate pages: nothing to emit
            if (!report) return true;

            const msg = baseMessage(p, f, report);
            msg.topic = 'Autoterm/rapport';
            node.send(msg);
            return true;
        }

        // Builds and sends the message for a valid frame
        function handleFrame(p) {
            const f = p.frame;

            if (!f || !f.crcValid) return;
            if (sourceFilter !== 'BOTH' && p.source !== sourceFilter) return;
            if (cmdFilter.length && !cmdFilter.includes(f.cmd)) return;

            // Heater type comes from the config node ("2D" by default)
            const heaterType = node.config.heaterType;

            let payload;
            try {
                payload = decodeFrame(f, heaterType);
            } catch (e) {
                node.warn(e.message);
                return;
            }

            // Panel read requests: hidden unless the option is checked
            const isRequest = payload.kind === 'request';
            if (isRequest && !config.requests) return;

            // EEPROM responses: page assembly, a single final message
            if (f.cmd === CMD_EEPROM && !isRequest && handleEeprom(p, f, payload)) {
                return;
            }

            // Diag frames (sent ~1/s when diag mode is enabled)
            if (f.cmd === CMD_DIAG && !isRequest && payload.unknown && handleDiag(p, f, payload)) {
                return;
            }

            const msg = baseMessage(p, f, payload);

            if (f.cmd === CMD_STATUS && !isRequest) {
                const fault = decodeError(payload.error_code);
                if (fault) msg.error = fault;

                if (payload.consumption_Lh !== undefined) {
                    msg.conso_l_h = payload.consumption_Lh;
                }
                msg.state = stateTable(payload.state);
            }

            node.send(msg);
        }

        // Proxy events (errors, unknown lines, "PROXY READY")
        function handleProxyEvent(p) {
            node.send({
                topic: 'Autoterm/proxy',
                payload: p,
                source: p.source,
                frame: p.bytes,
            });
        }

        this.listener = (p) => {
            if (p.kind === 'frame') {
                handleFrame(p);
            } else if (p.kind === 'error' || p.kind === 'unknown' || p.kind === 'ready') {
                handleProxyEvent(p);
            }
        };

        this.config.onLine(this.listener);
        this.on('close', () => this.config.removeLine(this.listener));
    }

    RED.nodes.registerType('autoterm-in', Input);
};