import { workerData } from "node:worker_threads";
import { simulateHistoricalAnalogues } from "./historical-analogue.js";

const state = new Int32Array(workerData.signalBuffer);
const output = new Uint8Array(workerData.resultBuffer);

function finish(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  if (bytes.length > output.length) {
    Atomics.store(state, 1, 0);
    Atomics.store(state, 0, 2);
    Atomics.notify(state, 0);
    return;
  }
  output.set(bytes);
  Atomics.store(state, 1, bytes.length);
  Atomics.store(state, 0, 1);
  Atomics.notify(state, 0);
}

try {
  const result = simulateHistoricalAnalogues(workerData.candles, workerData.options);
  finish({ ok: true, result });
} catch (error) {
  finish({ ok: false, error: String(error?.message || error) });
}
