/* SPDX-License-Identifier: GPL-2.0-or-later */
"use strict";

const { commandFrame } = require("../lib/commands");
const { parseHex } = require("../lib/frame");

// Delay between two frames of a batch (e.g. the "report" action)
const DELAY_BETWEEN_FRAMES_MS = 150;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = function (RED) {
  function Command(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    this.config = RED.nodes.getNode(config.serial);

    // Normalize the result into a batch of frames: [[bytes], [bytes], ...]
    function toBatch(frames) {
      return Array.isArray(frames[0]) ? frames : [frames];
    }

    // Converts msg.payload into a batch of frames.
    // Accepts: command object, JSON (string), hex frame (string or Buffer)
    function toFrames(payload) {
      // Buffer: raw frame
      if (Buffer.isBuffer(payload)) {
        return toBatch(parseHex(payload));
      }

      // String: JSON if it starts with "{", otherwise hex frame
      if (typeof payload === "string") {
        const text = payload.trim();
        if (text.startsWith("{")) {
          return toBatch(commandFrame(JSON.parse(text)));
        }
        return toBatch(parseHex(text));
      }

      // Command object (not an array)
      if (payload && typeof payload === "object" && !Array.isArray(payload)) {
        return toBatch(commandFrame(payload));
      }

      throw new Error(
        "payload must be a command object, a JSON string or a hex frame"
      );
    }

    // Sends the frames one by one, with a pause between each
    async function sendBatch(batch) {
      for (let i = 0; i < batch.length; i++) {
        await node.config.send(batch[i]);
        if (i < batch.length - 1) await sleep(DELAY_BETWEEN_FRAMES_MS);
      }
    }

    this.on("input", (msg, send, done) => {
      let batch;
      try {
        if (!node.config) {
          throw new Error("Autoterm serial configuration is required");
        }
        batch = toFrames(msg.payload);
      } catch (e) {
        node.error(e, msg);
        if (done) done(e);
        return;
      }

      sendBatch(batch)
        .then(() => {
          msg.frames = batch;
          send(msg);
          if (done) done();
        })
        .catch((e) => {
          node.error(e, msg);
          if (done) done(e);
        });
    });
  }

  RED.nodes.registerType("autoterm-command", Command);
};