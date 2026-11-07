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
      'ROLE: You are a cautious, screenshot-only technical market-structure analyst. Analyze the visible chart, not the broker brand or platform.',
      'UNIVERSAL SCOPE: Support any broker, charting interface, market, asset class, instrument, and timeframe, including forex, stocks, indices, commodities and crypto. Do not assume a symbol, session, price scale, interval, or indicator set.',
      'VISUAL EVIDENCE: Confirm a legible price chart and sufficient recent candles are visible. Assess candle bodies and wicks, swing highs/lows, trend structure, breakouts and failed breakouts, rejection wicks at visible levels, clearly evidenced support/resistance, candle closes, follow-through, momentum and deceleration. Use volume or indicators only if clearly visible; do not require or invent them.',
      'DIRECTION TEST: CALL requires clear bullish structure or momentum with visible follow-through and no equally strong opposing evidence. PUT requires clear bearish structure or momentum with visible follow-through and no equally strong opposing evidence. A single candle, isolated wick, or unsupported pattern is insufficient.',
      'STRICT STANDBY GATE: Return STANDBY immediately if price is sideways, range-bound, choppy, compressed, alternating without directional follow-through, at an unclear transition, or bullish and bearish evidence conflict. Also return STANDBY if the chart is cropped, blurry, obstructed, too zoomed out, has too few readable recent candles, or direction cannot be established confidently. When uncertain, STANDBY; never force a trade.',
      'ZERO-GUESSING: Use only facts directly visible in this screenshot. Do not infer hidden candles, missing prices, exact indicator values, news, fundamentals, future outcomes, or off-screen context. If symbol or timeframe cannot be read, return "unknown".',
      'OUTPUT: Return JSON only with keys signal, confidence, reason, symbol, timeframe. signal must be exactly CALL, PUT, or STANDBY. confidence must be a number from 0 to 1 and reflect visible evidence quality and consistency. For STANDBY, briefly explain uncertainty or sideways conditions. Never claim a signal is guaranteed or personalized financial advice.',
      'USER CONTEXT (not evidence; may be unknown): '+JSON.stringify({symbol:chartContext.symbol||'unknown',timeframe:chartContext.timeframe||'unknown'})
    ].join('\\n');
    let response;
    try {
      response=await fetchImpl('https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(model)+':generateContent?key='+encodeURIComponent(apiKey),{
        method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({contents:[{role:'user',parts:[{text:prompt},{inline_data:{mime_type:image.mimeType,data:image.buffer.toString('base64')}}]}],
          generationConfig:{temperature:0,responseMimeType:'application/json',responseSchema:{type:'OBJECT',properties:{
            signal:{type:'STRING',enum:['CALL','PUT','STANDBY']},confidence:{type:'NUMBER'},reason:{type:'STRING'},
            symbol:{type:'STRING'},timeframe:{type:'STRING'}},required:['signal','confidence','reason','symbol','timeframe']}})
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
    if(result.confidence<0.7) result.signal='STANDBY';
    return {signal:result.signal,confidence:result.confidence,reason:String(result.reason||'').slice(0,240),
      symbol:String(result.symbol||chartContext.symbol||'unknown'),timeframe:String(result.timeframe||chartContext.timeframe||'unknown'),
      provider:'gemini',model};
  };
}
module.exports={createGeminiVisionAdapter,VisionExtractionError};
