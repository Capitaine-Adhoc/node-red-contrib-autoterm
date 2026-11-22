/* SPDX-License-Identifier: GPL-2.0-or-later */
'use strict';

const {
  CMD,
  TOPICS,
  decodeFrame,
  decodeError,
  stateTable,
  createEepromAssembler,
  hexToBytes,
} = require('../lib/decoders');

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
    const eeprom = createEepromAssembler();

    // Common message for all decoded frames
    function baseMessage(p, f, topic, payload) {
      return {
        topic,
        payload,
        frame: f.bytes,
        source: p.source,
        cmd: f.cmd,
        type: f.type,
        device: f.device,
        raw: p.raw,
      };
    }

    // EEPROM page: accumulate, and only emit the full report.
    // Returns true if the frame was consumed (nothing more to send).
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

      node.send(baseMessage(p, f, TOPICS.REPORT, report));
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

      let decoded;
      try {
        decoded = decodeFrame(f, heaterType);
      } catch (e) {
        node.warn(e.message);
        return;
      }

      const { topic, payload } = decoded;

      // Panel read requests: hidden unless the option is checked
      const isRequest = topic === TOPICS.REQUEST;
      if (isRequest && !config.requests) return;

      // EEPROM responses: page assembly, a single final message
      if (f.cmd === CMD.EEPROM && !isRequest && handleEeprom(p, f, payload)) {
        return;
      }

      const msg = baseMessage(p, f, topic, payload);

      if (f.cmd === CMD.STATUS && !isRequest) {
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
        topic: TOPICS.PROXY,
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