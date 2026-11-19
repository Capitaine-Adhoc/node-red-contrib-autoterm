/* SPDX-License-Identifier: GPL-2.0-or-later */
"use strict";

// Fuel volume delivered per x100 pump pulse, in millilitres.
const PUMPS = new Map([
  ["2D", { ml_per_pulse: 4.4 }],
  ["4D", { ml_per_pulse: 6.8 }],
]);

const DEFAULT_PUMP = "2D";

module.exports = { PUMPS, DEFAULT_PUMP };