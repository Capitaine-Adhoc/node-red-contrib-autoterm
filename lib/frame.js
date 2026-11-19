/* SPDX-License-Identifier: GPL-2.0-or-later */
'use strict';

const { crc16 } = require('./crc');

// Device address byte
const DEFAULT_DEVICE = 0x03; // panel
const DEFAULT_TYPE = 0x00;
const FRAME_START = 0xAA;

// Converts an array/buffer into an array of validated bytes (integers 0..255)
function toBytes(input) {
  return Array.from(input, (n) => {
    const v = Number(n);
    if (!Number.isInteger(v) || v < 0 || v > 255) {
      throw new RangeError('Byte values must be integers from 0 to 255');
    }
    return v;
  });
}

// Builds a frame: AA | device | len | type | cmd | payload | CRC_hi | CRC_lo
function buildFrame(cmd, payload = [], opts = {}) {
  const device = opts.device === undefined ? DEFAULT_DEVICE : opts.device;
  const type = opts.type === undefined ? DEFAULT_TYPE : opts.type;

  const data = toBytes(payload);
  if (data.length > 255) throw new RangeError('Payload too long');

  const frame = [FRAME_START, device, data.length, type, Number(cmd), ...data];
  const crc = crc16(frame);
  frame.push(crc >>> 8, crc & 255);

  return frame;
}

// Parses a complete frame and checks its length and CRC
function parseFrame(input, options = {}) {
  const bytes = toBytes(input);

  if (bytes.length < 7) throw new Error('Frame too short');
  if (bytes[0] !== FRAME_START) throw new Error('Invalid frame start');

  const expectedLength = 5 + bytes[2] + 2;
  if (bytes.length !== expectedLength) {
    throw new Error(`Frame length mismatch: expected ${expectedLength}, got ${bytes.length}`);
  }

  const receivedCrc = (bytes[bytes.length - 2] << 8) | bytes[bytes.length - 1];
  const computedCrc = crc16(bytes.slice(0, -2));

  if (options.checkCrc !== false && receivedCrc !== computedCrc) {
    throw new Error('CRC mismatch');
  }

  return {
    bytes,
    device: bytes[1],
    payloadLength: bytes[2],
    type: bytes[3],
    cmd: bytes[4],
    payload: bytes.slice(5, -2),
    crc: receivedCrc,
    crcValid: receivedCrc === computedCrc,
  };
}

// Accepts "AA 03 00", "0xAA,0x03", an array or a Buffer
function parseHex(input) {
  if (Array.isArray(input) || Buffer.isBuffer(input)) return toBytes(input);
  if (typeof input !== 'string') throw new TypeError('Expected hex string or byte array');

  const text = input.trim();
  if (!text) throw new Error('Empty hex frame');

  const parts = text.split(/[\s,:-]+/).filter(Boolean);
  if (parts.some((p) => !/^(?:0x)?[0-9a-f]{2}$/i.test(p))) {
    throw new Error('Invalid hex byte');
  }

  return parts.map((p) => parseInt(p.replace(/^0x/i, ''), 16));
}

// Parses a line sent by the Arduino proxy
function parseProxyLine(line) {
  const text = String(line).trim();

  if (text === 'PROXY READY') return { kind: 'ready', raw: text };

  const error = text.match(/^ERR\s+(HEX|LENGTH|CRC|BUSY|OVERFLOW)\b(.*)$/i);
  if (error) {
    return { kind: 'error', code: error[1].toUpperCase(), detail: error[2].trim(), raw: text };
  }

  if (/^INJ:/i.test(text)) return { kind: 'injection', raw: text };

  // Format: "H: AA 03 00 00 0F 58 7C [CRC OK]"
  // Isolate the source prefix, the hex block and the annotation separately
  const match = text.match(/^([CH]):\s*(.+?)\s*\[(CRC OK|CRC KO|BROKEN)\]\s*$/i);
  if (!match) return { kind: 'unknown', raw: text };

  const source = match[1].toUpperCase();
  const annotation = match[3].toUpperCase();

  let rawBytes;
  try {
    rawBytes = parseHex(match[2]);
  } catch (e) {
    return { kind: 'frame', source, annotation, raw: text, bytes: [], frame: null, frameError: e.message };
  }

  let frame = null;
  let frameError = null;
  try {
    frame = parseFrame(rawBytes, { checkCrc: annotation === 'CRC OK' });
  } catch (e) {
    frameError = e.message;
  }

  // An invalid frame must never reach the decoder
  if (frameError) {
    return { kind: 'error', code: 'FRAME', detail: frameError, source, raw: text, bytes: rawBytes };
  }

  return { kind: 'frame', source, annotation, raw: text, bytes: rawBytes, frame, frameError: null };
}

module.exports = { buildFrame, parseFrame, parseHex, parseProxyLine };