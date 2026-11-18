export const DEFAULT_ANALYZER_CONTROL = Object.freeze({ mode: "ORIGINAL", minScore: 25 });

export function normalizeAnalyzerControl(value) {
  const mode = value?.mode === "CUSTOM" ? "CUSTOM" : "ORIGINAL";
  const raw = Number(value?.minScore);
  const minScore = Number.isInteger(raw) && raw >= 5 && raw <= 100 ? raw : 25;
  return { mode, minScore };
}

export function getAnalyzerTuning(value) {
  const control = normalizeAnalyzerControl(value);
  if (control.mode === "ORIGINAL") {
    return {
      ...control,
      v1SignalThreshold: 55, v1PrepareThreshold: 40, v1DirectionalMargin: 0,
      v1ChoppyGapAtr: 0.12,
      bbRequiredCues: 1, bbWickThreshold: 0.18,
      trendSignalThreshold: 65, trendDirectionalMargin: 12,
      trendSidewaysGapAtr: 0.12, trendLateExtensionAtr: 1.5,
      engine4SignalThreshold: 40, engine4DirectionalMargin: 10, engine4TrendGapAtr: 0.05,
      engine4MinPullbackAtr: 0.04, engine4MaxPullbackAtr: 2.2,
      engine4CloseLocation: 0.52, engine4WickThreshold: 0.08
    };
  }
  const strictness = (control.minScore - 5) / 95;
  return {
    ...control,
    v1SignalThreshold: control.minScore,
    v1PrepareThreshold: Math.max(5, control.minScore - 15),
    v1DirectionalMargin: Math.max(2, Math.round(2 + strictness * 10)),
    v1ChoppyGapAtr: 0.04 + strictness * 0.14,
    bbRequiredCues: control.minScore <= 35 ? 1 : control.minScore <= 70 ? 2 : 3,
    bbWickThreshold: 0.04 + strictness * 0.36,
    trendSignalThreshold: control.minScore,
    trendDirectionalMargin: Math.max(2, Math.round(2 + strictness * 10)),
    trendSidewaysGapAtr: 0.04 + strictness * 0.14,
    trendLateExtensionAtr: 2.2 - strictness * 0.7,
    engine4SignalThreshold: control.minScore,
    engine4DirectionalMargin: Math.max(2, Math.round(2 + strictness * 8)),
    engine4TrendGapAtr: 0.02 + strictness * 0.06,
    engine4MinPullbackAtr: 0.02 + strictness * 0.08,
    engine4MaxPullbackAtr: 2.6 - strictness * 0.4,
    engine4CloseLocation: 0.50 + strictness * 0.12,
    engine4WickThreshold: 0.04 + strictness * 0.16
  };
}
