'use strict';
class VisionExtractionError extends Error {
  constructor(status, code, message) { super(message); this.status=status; this.code=code; }
}
function createGeminiVisionAdapter({apiKey=process.env.GEMINI_API_KEY, model=process.env.GEMINI_VISION_MODEL||'gemini-2.5-flash', fetchImpl=globalThis.fetch}={}) {
  return async function analyzeScreenshot(image, chartContext={}) {
    if (!apiKey) throw new VisionExtractionError(503,'GEMINI_API_KEY_MISSING','Gemini Vision is not configured on this test server');
    if (!image?.buffer || !['image/jpeg','image/png','image/webp'].includes(image.mimeType))
      throw new VisionExtractionError(415,'UNSUPPORTED_IMAGE','A JPEG, PNG or WebP screenshot is required');
    const prompt = [
      'ROLE: You are an active, decisive screenshot-only price-action analyst. Your task is to identify which side currently has the stronger visible short-term directional advantage.',
      'UNIVERSAL SCOPE: Analyze charts from any broker, platform, market, asset class, instrument, and timeframe. Do not assume a symbol, price scale, session, timeframe, or indicator set.',
      'FIRST VALIDATE THE IMAGE: Return STANDBY only if the image is corrupted, not actually a chart, or so unreadable that candles and price direction cannot be visually identified. If the chart is readable, you MUST return CALL or PUT. Do not use STANDBY merely because the market is ranging, choppy, low momentum, uncertain, or because bullish and bearish evidence are mixed.',
      'MANDATORY DIRECTIONAL EVALUATION: Assess (1) recent candle body direction, size and sequence, (2) upper/lower rejection wicks and failed pushes, (3) swing highs/lows and visible trend structure, (4) support/resistance reactions and breakouts or failed breakouts, (5) latest candle close, follow-through, momentum and deceleration. Use indicators or volume only when clearly visible; never invent values.',
      'DECISION RULE: Compare bullish and bearish evidence and select the side with the stronger overall visible advantage. Return CALL when buying pressure, bullish continuation, bullish rejection, or bullish reversal evidence is dominant. Return PUT when selling pressure, bearish continuation, bearish rejection, or bearish reversal evidence is dominant.',
      'RANGE / MIXED-MARKET RULE: A sideways or choppy chart is NOT a reason for STANDBY. Inspect the most recent readable candles and identify the current micro-bias: bullish if buyers are gaining ground, closes are recovering, lower wicks/reclaims are more persuasive, or recent lows are defended; bearish if sellers are gaining ground, closes are weakening, upper wicks/rejections are more persuasive, or recent highs are defended. If evidence remains closely balanced, use the latest completed candle and the nearest visible rejection/level reaction as a tie-breaker, then choose CALL or PUT according to the slight directional edge. Never describe this forced choice as high-confidence when evidence is weak.',
      'CONFIDENCE: Report confidence honestly from 0 to 1. Low confidence does NOT change a readable-chart CALL/PUT into STANDBY. Confidence expresses evidence strength, not permission to abstain. A weak directional edge should receive low confidence and a concise reason.',
      'EVIDENCE DISCIPLINE: Use only visible screenshot information. Do not infer hidden candles, off-screen prices, news, fundamentals, exact indicator values, or future outcomes. If symbol or timeframe cannot be read, return "unknown". Do not claim certainty or guaranteed results.',
      'OUTPUT: Return JSON only with keys signal, confidence, reason, symbol, timeframe. signal must be exactly CALL, PUT, or STANDBY. STANDBY is reserved exclusively for invalid, corrupted, non-chart, or completely unreadable images. For every readable chart, choose CALL or PUT.',
      'USER CONTEXT (not visual evidence; may be unknown): '+JSON.stringify({symbol:chartContext.symbol||'unknown',timeframe:chartContext.timeframe||'unknown'})
    ].join('\\n');
    let response;
    try {
      response=await fetchImpl('https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(model)+':generateContent?key='+encodeURIComponent(apiKey),{
        method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({contents:[{role:'user',parts:[{text:prompt},{inline_data:{mime_type:image.mimeType,data:image.buffer.toString('base64')}}]}],
          generationConfig:{temperature:0,responseMimeType:'application/json',responseSchema:{type:'OBJECT',properties:{
            signal:{type:'STRING',enum:['CALL','PUT','STANDBY']},confidence:{type:'NUMBER'},reason:{type:'STRING'},
            symbol:{type:'STRING'},timeframe:{type:'STRING'}},required:['signal','confidence','reason','symbol','timeframe']}}})
      });
    } catch(e) { throw new VisionExtractionError(502,'GEMINI_UNAVAILABLE','Gemini Vision request failed: '+e.message); }
    if(!response.ok) {
      const detail=await response.text().catch(()=> '');
      const quota=response.status===429;
      throw new VisionExtractionError(quota?503:502,quota?'GEMINI_QUOTA_EXCEEDED':'GEMINI_PROVIDER_ERROR','Gemini Vision returned HTTP '+response.status+': '+detail.slice(0,350));
    }
    const payload=await response.json();
    const text=payload.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('');
    if(!text) throw new VisionExtractionError(502,'GEMINI_EMPTY_RESPONSE','Gemini returned no analysis');
    let result; try { result=JSON.parse(text); } catch { throw new VisionExtractionError(502,'GEMINI_INVALID_JSON','Gemini returned invalid JSON'); }
    if(!['CALL','PUT','STANDBY'].includes(result.signal)||!Number.isFinite(result.confidence)||result.confidence<0||result.confidence>1)
      throw new VisionExtractionError(502,'GEMINI_INVALID_RESULT','Gemini returned an invalid signal result');
    return {signal:result.signal,confidence:result.confidence,reason:String(result.reason||'').slice(0,240),
      symbol:String(result.symbol||chartContext.symbol||'unknown'),timeframe:String(result.timeframe||chartContext.timeframe||'unknown'),
      provider:'gemini',model};
  };
}
module.exports={createGeminiVisionAdapter,VisionExtractionError};
