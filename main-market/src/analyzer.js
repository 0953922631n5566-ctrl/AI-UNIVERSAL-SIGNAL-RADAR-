import { simulateHistoricalAnalogues } from "./historical-analogue.js";
// Sole decision engine: historical analogue simulation. No indicator scoring.
export function analyzeMarket(candles,options={}) { return simulateHistoricalAnalogues(candles,options); }
