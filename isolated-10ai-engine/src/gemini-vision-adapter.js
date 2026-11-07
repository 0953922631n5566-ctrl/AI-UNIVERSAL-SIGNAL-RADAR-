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
      'Analyze this single screenshot of a financial trading chart. Return JSON only with keys signal, confidence, reason, symbol, timeframe.',
      'signal must be exactly CALL, PUT, or STANDBY. Be conservative: use STANDBY if the chart is unclear, indicators conflict, price action is ambiguous, or the screenshot lacks enough visible evidence.',
      'Do not invent prices, indicators, candles, timestamps, or hidden context. This is a visual assessment, not a guarantee or personalized financial advice.',
      'confidence must be a number from 0 to 1 and must reflect uncertainty honestly. Only use CALL or PUT when visible evidence is clear and mutually consistent; otherwise STANDBY.',
      'Keep reason concise. Context: '+JSON.stringify({symbol:chartContext.symbol||'unknown',timeframe:chartContext.timeframe||'unknown'})
    ].join('\n');
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
    if(result.confidence<0.7) result.signal='STANDBY';
    return {signal:result.signal,confidence:result.confidence,reason:String(result.reason||'').slice(0,240),
      symbol:String(result.symbol||chartContext.symbol||'unknown'),timeframe:String(result.timeframe||chartContext.timeframe||'unknown'),
      provider:'gemini',model};
  };
}
module.exports={createGeminiVisionAdapter,VisionExtractionError};
