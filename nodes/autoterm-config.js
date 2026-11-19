/* SPDX-License-Identifier: GPL-2.0-or-later */
"use strict";

const EventEmitter = require("events");
const { SerialPort } = require("serialport");
const { parseProxyLine, parseHex } = require("../lib/frame");
const { PUMPS, DEFAULT_PUMP } = require("../lib/pumps");

const MIN_RETRY_DELAY_MS = 250;
const DEFAULT_BAUD_RATE = 115200;
const DEFAULT_RETRY_DELAY_MS = 2000;
const DEFAULT_MAX_RETRIES = 3;

module.exports = function (RED) {
  function AutotermConfig(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    // --- Parameters --------------------------------------------------------
    this.portPath = config.port || "";
    this.baudRate = Number(config.baudRate) || DEFAULT_BAUD_RATE;
    this.heaterType = PUMPS.has(config.heaterType) ? config.heaterType : DEFAULT_PUMP;
    this.retryDelay = Math.max(
      MIN_RETRY_DELAY_MS,
      Number(config.retryDelay) || DEFAULT_RETRY_DELAY_MS
    );
    this.maxRetries = Math.max(
      0,
      Number(config.maxRetries === undefined ? DEFAULT_MAX_RETRIES : config.maxRetries)
    );

    // --- Internal state ----------------------------------------------------
    this.bus = new EventEmitter(); // broadcasts proxy lines to the nodes
    this.bus.setMaxListeners(0);
    this.port = null;
    this.buffer = "";              // received bytes, not yet split into lines
    this.closedFlag = false;
    this.pending = null;           // write waiting for a proxy response
    this.retryTimer = null;

    function setStatus(fill, text) {
      node.status({ fill, shape: "dot", text });
    }

    // Reports a serial error without ever letting it throw
    function reportError(message, err) {
      node.error(`Serial: ${message}`);
      node.bus.emit("serial-error", err);
    }

    // --- Serial connection -------------------------------------------------
    function connect() {
      if (node.closedFlag || !node.portPath) return;

      let port;
      try {
        port = new SerialPort({
          path: node.portPath,
          baudRate: node.baudRate,
          autoOpen: false,
        });
      } catch (e) {
        reportError(e.message, e);
        setStatus("red", "invalid port");
        scheduleReconnect();
        return;
      }

      node.port = port;

      // Splits the incoming stream into lines terminated by LF
      port.on("data", (chunk) => {
        node.buffer += chunk.toString("utf8");
        let index;
        while ((index = node.buffer.indexOf("\n")) >= 0) {
          const line = node.buffer.slice(0, index).replace(/\r$/, "");
          node.buffer = node.buffer.slice(index + 1);
          handleLine(line);
        }
      });

      port.on("error", (e) => {
        setStatus("red", "serial error");
        reportError(e.message, e);
      });

      port.on("close", () => {
        node.port = null;
        if (!node.closedFlag) {
          setStatus("yellow", "reconnecting");
          scheduleReconnect();
        }
      });

      port.open((err) => {
        if (err) {
          setStatus("red", "open failed");
          reportError(`open failed (${node.portPath}): ${err.message}`, err);
          // We remove the data/close listeners, but keep an error listener
          // so that close() does not crash Node-RED
          port.removeAllListeners("data");
          port.removeAllListeners("close");
          port.on("error", () => {});
          port.close(() => {});
          node.port = null;
          scheduleReconnect();
          return;
        }
        setStatus("green", "connected");
        node.bus.emit("ready");
      });
    }

    // Schedules a new connection attempt (only one at a time)
    function scheduleReconnect() {
      if (node.closedFlag || node.retryTimer) return;
      node.retryTimer = setTimeout(() => {
        node.retryTimer = null;
        connect();
      }, node.retryDelay);
    }

    // --- Lines received from the proxy -------------------------------------
    function handleLine(line) {
      if (!line.trim()) return;

      const parsed = parseProxyLine(line);

      // Proxy busy: retry the pending write, up to maxRetries
      const canRetry =
        parsed.kind === "error" &&
        parsed.code === "BUSY" &&
        node.pending &&
        node.pending.retries < node.maxRetries;

      if (canRetry) {
        const job = node.pending;
        job.retries++;
        node.pending = null;
        setTimeout(() => writeJob(job), node.retryDelay);
      } else if (parsed.kind === "error" && node.pending) {
        node.pending.reject(
          new Error(`Proxy ERR ${parsed.code}: ${parsed.detail}`)
        );
        node.pending = null;
      } else if (parsed.kind === "injection" && node.pending) {
        node.pending.resolve(parsed);
        node.pending = null;
      }

      node.bus.emit("line", parsed);
    }

    // --- Serial writing ----------------------------------------------------
    function writeJob(job) {
      if (node.closedFlag) {
        job.reject(new Error("Serial config closed"));
        return;
      }

      if (!node.port || !node.port.isOpen) {
        node.pending = null;
        job.reject(new Error("Serial port is not open"));
        return;
      }

      if (node.pending) {
        job.reject(new Error("Serial write already pending (ERR BUSY)"));
        return;
      }

      node.pending = job;
      node.port.write(job.hex + "\n", (err) => {
        if (err) {
          if (node.pending === job) node.pending = null;
          job.reject(err);
          return;
        }
        node.port.drain((e) => {
          if (e && node.pending === job) {
            node.pending = null;
            job.reject(e);
          }
        });
      });
    }

    // --- Public API for other nodes ----------------------------------------
    this.send = function (input) {
      let bytes;
      try {
        bytes = parseHex(input);
      } catch (e) {
        return Promise.reject(e);
      }

      const hex = bytes
        .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
        .join(" ");

      return new Promise((resolve, reject) => {
        writeJob({ hex, retries: 0, resolve, reject });
      });
    };

    this.onLine = (fn) => node.bus.on("line", fn);
    this.removeLine = (fn) => node.bus.off("line", fn);

    // --- Closing -----------------------------------------------------------
    this.on("close", () => {
      node.closedFlag = true;
      if (node.retryTimer) clearTimeout(node.retryTimer);

      if (node.pending) {
        node.pending.reject(new Error("Serial config closed"));
        node.pending = null;
      }

      if (node.port && node.port.isOpen) node.port.close();
    });

    connect();
  }
  RED.nodes.registerType("autoterm-config", AutotermConfig);
};