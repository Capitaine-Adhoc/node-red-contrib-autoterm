/* SPDX-License-Identifier: GPL-2.0-or-later */
"use strict";

const helper = require('node-red-node-test-helper');
const assert = require('assert');

const configNode = require('../nodes/autoterm-config');
const inNode = require('../nodes/autoterm-in');
const commandNode = require('../nodes/autoterm-command');
const { buildFrame, parseProxyLine } = require('../lib/frame');
const { TOPICS } = require('../lib/decoders');

// Construit une ligne du proxy à partir d'une trame : "H: AA 03 ... [CRC OK]"
function proxyLine(source, bytes) {
    const hex = bytes
        .map((x) => x.toString(16).padStart(2, '0'))
        .join(' ')
        .toUpperCase();
    return `${source}: ${hex} [CRC OK]`;
}

describe('Node-RED nodes', function () {
    this.timeout(10000);

    before(() => helper.init(require.resolve('node-red')));
    afterEach(() => helper.unload());

    it('routes a decoded status from a simulated proxy line', (done) => {
        const flow = [
            { id: 'cfg', type: 'autoterm-config', port: '', baudRate: 115200 },
            { id: 'src', type: 'autoterm-in', serial: 'cfg', wires: [['sink']] },
            { id: 'sink', type: 'helper' },
        ];

        helper.load([configNode, inNode, commandNode], flow, () => {
            const sink = helper.getNode('sink');
            const cfg = helper.getNode('cfg');

            sink.on('input', (msg) => {
                try {
                    assert.equal(msg.topic, TOPICS.STATUS);
                    assert.equal(msg.source, 'H');
                    assert.equal(msg.cmd, 0x0F);
                    assert.equal(msg.payload.state_code, 4);
                    assert.equal(msg.payload.state, 'Running');
                    assert.deepEqual(msg.state, {
                        '/GenericInput/0/Value': 2,
                        '/GenericInput/0/Status': 0,
                    });
                    assert.equal(msg.frame.length, 26);
                    done();
                } catch (e) {
                    done(e);
                }
            });

            // Réponse du chauffage : état 4 = "Running"
            const data = Array(19).fill(0);
            data[9] = 4;
            const frame = buildFrame(0x0F, data);
            cfg.bus.emit('line', parseProxyLine(proxyLine('H', frame)));
        });
    });

    it('accepts high-level command input and calls the configured sender', (done) => {
        const flow = [
            { id: 'fakecfg', type: 'helper' },
            { id: 'cmd', type: 'autoterm-command', serial: 'fakecfg', wires: [['sink']] },
            { id: 'sink', type: 'helper' },
        ];

        helper.load([commandNode], flow, () => {
            const cfg = helper.getNode('fakecfg');
            const cmd = helper.getNode('cmd');
            const sink = helper.getNode('sink');

            cfg.send = async (bytes) => {
                assert.equal(bytes[4], 0x0F);
            };

            sink.on('input', (msg) => {
                try {
                    assert.equal(msg.frames.length, 1);
                    done();
                } catch (e) {
                    done(e);
                }
            });
            cmd.receive({ payload: { action: 'status' } });
        });
    });
});