package com.universalbrokervision
import android.app.*
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.Image
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.*
import android.util.Base64
import android.util.DisplayMetrics
import android.view.WindowManager
import androidx.core.app.NotificationCompat
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.nio.ByteBuffer
import java.io.ByteArrayOutputStream
import java.util.concurrent.atomic.AtomicBoolean

class CaptureService:Service() {
 companion object {
  const val ACTION_START="com.universalbrokervision.START"
  const val EXTRA_RESULT_CODE="resultCode";const val EXTRA_RESULT_DATA="resultData"
  const val EXTRA_ENDPOINT="endpoint";const val EXTRA_TOKEN="token"
  private const val CHANNEL="broker_vision_capture";private const val NOTIFICATION_ID=901
  // Target a sub-second capture cadence; actual throughput is bounded by OCR and device load.
  private const val CAPTURE_INTERVAL_MS=150L
 }
 private var projection:MediaProjection?=null;private var display:VirtualDisplay?=null;private var reader:ImageReader?=null
 private var worker:HandlerThread?=null;private var handler:Handler?=null;private var endpoint="";private var token=""
 private var lastAt=0L;private var lastImageUploadAt=0L;private val busy=AtomicBoolean(false);private val uploading=AtomicBoolean(false)
 private val recognizer by lazy { TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS) }
 override fun onBind(intent:Intent?):IBinder?=null
 override fun onStartCommand(intent:Intent?,flags:Int,startId:Int):Int {
  if(intent?.action!=ACTION_START){stopSelf();return START_NOT_STICKY}
  endpoint=intent.getStringExtra(EXTRA_ENDPOINT).orEmpty();token=intent.getStringExtra(EXTRA_TOKEN).orEmpty()
  createChannel()
  val note=NotificationCompat.Builder(this,CHANNEL).setSmallIcon(android.R.drawable.ic_menu_camera)
   .setContentTitle("Broker Vision AI").setContentText("กำลังจับภาพหน้าจอและอ่านกราฟ").setOngoing(true).build()
  if(Build.VERSION.SDK_INT>=29)startForeground(NOTIFICATION_ID,note,android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
  else startForeground(NOTIFICATION_ID,note)
  val code=intent.getIntExtra(EXTRA_RESULT_CODE,0)
  val data=if(Build.VERSION.SDK_INT>=33)intent.getParcelableExtra(EXTRA_RESULT_DATA,Intent::class.java) else @Suppress("DEPRECATION") (intent.getParcelableExtra(EXTRA_RESULT_DATA) as? Intent)
  if(data==null){stopSelf();return START_NOT_STICKY}
  val manager=getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
  projection=manager.getMediaProjection(code,data);startCapture();return START_NOT_STICKY
 }
 private fun createChannel(){if(Build.VERSION.SDK_INT>=26)getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel(CHANNEL,"Broker Vision Capture",NotificationManager.IMPORTANCE_LOW))}
 private fun startCapture(){
  val metrics=DisplayMetrics();@Suppress("DEPRECATION")
  (getSystemService(WINDOW_SERVICE) as WindowManager).defaultDisplay.getRealMetrics(metrics)
  worker=HandlerThread("vision-frame-reader").also{it.start()};handler=Handler(worker!!.looper)
  reader=ImageReader.newInstance(metrics.widthPixels,metrics.heightPixels,PixelFormat.RGBA_8888,3)
  reader?.setOnImageAvailableListener({src->
   val image=src.acquireLatestImage()?:return@setOnImageAvailableListener
   val capturedAt=System.currentTimeMillis()
   if(capturedAt-lastAt<CAPTURE_INTERVAL_MS||!busy.compareAndSet(false,true)){image.close();return@setOnImageAvailableListener}
   lastAt=capturedAt;process(image,capturedAt)
  },handler)
  projection?.registerCallback(object:MediaProjection.Callback(){override fun onStop(){stopSelf()}},handler)
  display=projection?.createVirtualDisplay("BrokerVisionDisplay",metrics.widthPixels,metrics.heightPixels,metrics.densityDpi,
   DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,reader?.surface,null,handler)
 }
 private fun process(image:Image,capturedAt:Long){
  try {
   val bitmap=toBitmap(image);image.close()
   recognizer.process(InputImage.fromBitmap(bitmap,0)).addOnSuccessListener{result->
    // Keep the full right edge: broker live-price badges are often flush with the screen edge.
    val chartLines=result.textBlocks.flatMap{it.lines}.filter{line->
     val box=line.boundingBox
     box!=null && box.right>bitmap.width*.04f && box.left<bitmap.width.toFloat() &&
      box.top>bitmap.height*.06f && box.bottom<bitmap.height*.96f
    }
    val ocr=JSONArray()
    chartLines.forEach{line->val box=line.boundingBox
     ocr.put(JSONObject().put("text",line.text).put("left",box?.left?:0).put("top",box?.top?:0).put("right",box?.right?:0).put("bottom",box?.bottom?:0))
    }
    val headerText=chartLines.filter{line->val box=line.boundingBox;box!=null&&box.left<bitmap.width*.65f&&box.top<bitmap.height*.32f}
     .joinToString(" "){it.text}
    val pairPattern=Regex("""[A-Z]{3}\s*/\s*[A-Z]{3}(?:\s*\(OTC\))?""")
    val pair=pairPattern.find(headerText)?.value?.replace(" ","")
    // Do not mistake broker branding/page text for a tradable instrument.
    val symbol=pair?:"UNKNOWN"
    val pricePattern=Regex("""(?<!\d)(\d{1,4})[.,](\d{2,10})(?!\d)""")
    data class PriceHit(val value:Double,val left:Int,val width:Int,val precision:Int,val y:Float)
    val priceCandidates=chartLines.mapNotNull{line->
     val box=line.boundingBox
     val raw=line.text.trim().replace(Regex("""(?<=\d)[ ]+(?=\d)"""),"")
     // Accept decimal comma as well as decimal point, while keeping thousands-grouped values safe.
     val match=pricePattern.findAll(raw).lastOrNull()
     val normalized=match?.let{it.groupValues[1]+"."+it.groupValues[2]}
     val value=normalized?.toDoubleOrNull()
     val precision=match?.groupValues?.getOrNull(2)?.length?:0
     if(box!=null && box.width()>bitmap.width*.006f &&
       box.top>bitmap.height*.04f && box.top<bitmap.height*.96f && value!=null && value>0)
      PriceHit(value,box.left,box.width(),precision,(box.top+box.bottom)/2f) else null
    }
    val detectedCandles=detectCandles(bitmap)
    val latestCloseY=if(detectedCandles.length()>0) detectedCandles.optJSONObject(detectedCandles.length()-1)?.optDouble("closeY")?.toFloat() else null
    val rightCandidates=priceCandidates.filter{it.left>bitmap.width*.70f}
    val selectedPrice=if(latestCloseY!=null&&rightCandidates.isNotEmpty())
      rightCandidates.minByOrNull{ kotlin.math.abs(it.y-latestCloseY) }
     else rightCandidates.maxByOrNull{it.left+it.width}
    val price=selectedPrice?.value
    val pricePrecision=selectedPrice?.precision?:0
    val axisPrices=JSONArray()
    chartLines.forEach{line->
     val box=line.boundingBox
     if(box!=null&&box.left>bitmap.width*.78f){
      val match=pricePattern.findAll(line.text.trim().replace(Regex("""(?<=\d)[ ]+(?=\d)"""),"")).lastOrNull()
      val value=match?.let{(it.groupValues[1]+"."+it.groupValues[2]).toDoubleOrNull()}
      if(value!=null)axisPrices.put(JSONObject().put("price",value).put("y",(box.top+box.bottom)/2f))
     }
    }
    if(selectedPrice!=null && axisPrices.length()==0)
      axisPrices.put(JSONObject().put("price",selectedPrice.value).put("y",selectedPrice.y))
    val timeframeRegion=chartLines.filter{line->val box=line.boundingBox;box!=null&&box.top>bitmap.height*.12f&&box.top<bitmap.height*.88f}
    val timeframePattern=Regex("""(?i)\b(?:[1-9]\d?[smhd]|[smhd][1-9]\d?)\b""")
    val timeframeText=timeframeRegion.joinToString(" "){it.text}
     .replace(Regex("""(?i)\b[il]m\b"""),"1m")
     .replace(Regex("""(?i)\bsm\b"""),"5m")
    val timeframeHit=timeframePattern.find(timeframeText)?.value?.uppercase()?:""
    val timeframe=when {
     timeframeHit.matches(Regex("""(?i)^[SMHD][1-9]\d?$"""))->timeframeHit.drop(1)+timeframeHit.take(1)
     timeframeHit.matches(Regex("""(?i)^[1-9]\d?[SMHD]$"""))->timeframeHit
     else->"UNKNOWN"
    }
    val payload=JSONObject().put("width",bitmap.width).put("height",bitmap.height).put("deviceTime",capturedAt)
      .put("ocrLatencyMs",(System.currentTimeMillis()-capturedAt).coerceAtLeast(0L))
     .put("symbol",symbol).put("timeframe",timeframe).put("price",price).put("pricePrecision",pricePrecision)
     .put("axisPrices",axisPrices).put("ocr",ocr).put("candles",detectedCandles)
     .put("chart",JSONObject().put("capture","full-screen"))
    upload(payload,bitmap);bitmap.recycle()
   }.addOnFailureListener{bitmap.recycle();busy.set(false)}
  }catch(e:Exception){try{image.close()}catch(_:Exception){};busy.set(false)}
 }
 private fun toBitmap(image:Image):Bitmap {
  val plane=image.planes[0];val buffer:ByteBuffer=plane.buffer;val stride=plane.pixelStride
  val padded=Bitmap.createBitmap(image.width+((plane.rowStride-stride*image.width)/stride),image.height,Bitmap.Config.ARGB_8888)
  padded.copyPixelsFromBuffer(buffer);val cropped=Bitmap.createBitmap(padded,0,0,image.width,image.height);padded.recycle();return cropped
 }
 private fun detectCandles(bitmap:Bitmap):JSONArray {
  val out=JSONArray();val top=(bitmap.height*.16f).toInt();val bottom=(bitmap.height*.88f).toInt()
  val start=(bitmap.width*.13f).toInt();val end=(bitmap.width*.82f).toInt()
  data class C(val x:Int,val color:String,val top:Int,val bottom:Int)
  val columns=mutableListOf<C>()
  for(x in start until end step 2){
   var active:String?=null;var runStart=0;var runEnd=0;var runLength=0
   var bestColor="";var bestTop=0;var bestBottom=0;var bestLength=0
   for(y in top until bottom step 2){
    val c=bitmap.getPixel(x,y);val r=android.graphics.Color.red(c);val g=android.graphics.Color.green(c);val b=android.graphics.Color.blue(c)
    val kind=when{g>r*1.28&&g>b*1.05&&g>75->"GREEN";r>g*1.22&&r>b*1.05&&r>85->"RED";else->null}
    if(kind!=null&&kind==active&&y-runEnd<=2){runLength++;runEnd=y}
    else{
     if(runLength>bestLength){bestLength=runLength;bestColor=active.orEmpty();bestTop=runStart;bestBottom=runEnd}
     active=kind;runStart=y;runEnd=y;runLength=if(kind!=null)1 else 0
    }
   }
   if(runLength>bestLength){bestLength=runLength;bestColor=active.orEmpty();bestTop=runStart;bestBottom=runEnd}
   if(bestLength>=3)columns.add(C(x,bestColor,bestTop,bestBottom))
  }
  val groups=mutableListOf<MutableList<C>>()
  columns.forEach{c->val last=groups.lastOrNull();if(last!=null&&last.last().color==c.color&&c.x-last.last().x<=6)last.add(c)else groups.add(mutableListOf(c))}
  groups.filter{it.size>=2}.takeLast(100).forEach{g->
   val bodyTop=g.minOf{it.top};val bodyBottom=g.maxOf{it.bottom};val color=g.first().color
   val centerX=g.map{it.x}.average().toInt()
   var wickTop=bodyTop;var wickBottom=bodyBottom
   for(x in (centerX-2)..(centerX+2))for(y in top until bottom){
    val px=bitmap.getPixel(x,y);val r=android.graphics.Color.red(px);val gr=android.graphics.Color.green(px);val b=android.graphics.Color.blue(px)
    val same=if(color=="GREEN")gr>r*1.28&&gr>b*1.05&&gr>75 else r>gr*1.22&&r>b*1.05&&r>85
    if(same){wickTop=minOf(wickTop,y);wickBottom=maxOf(wickBottom,y)}
   }
   out.put(JSONObject().put("x",centerX).put("color",color)
    .put("openY",if(color=="GREEN")bodyBottom else bodyTop).put("closeY",if(color=="GREEN")bodyTop else bodyBottom)
    .put("bodyTopY",bodyTop).put("bodyBottomY",bodyBottom)
    .put("highY",wickTop).put("lowY",wickBottom).put("bodyHeight",bodyBottom-bodyTop))
  };return out
 }
 private fun upload(payload:JSONObject,source:Bitmap){
  if(!uploading.compareAndSet(false,true)){busy.set(false);return}
  // Keep a diagnostic screenshot occasionally, but avoid JPEG/base64 work on every live price frame.
  val now=System.currentTimeMillis()
  if(now-lastImageUploadAt>=5000L){
   try{
    val left=(source.width*.08f).toInt().coerceAtLeast(0)
    val top=(source.height*.10f).toInt().coerceAtLeast(0)
    val right=(source.width*.93f).toInt().coerceAtMost(source.width)
    val bottom=(source.height*.90f).toInt().coerceAtMost(source.height)
    val crop=Bitmap.createBitmap(source,left,top,(right-left).coerceAtLeast(1),(bottom-top).coerceAtLeast(1))
    val scale=minOf(1f,960f/crop.width,1200f/crop.height)
    val resized=if(scale<1f)Bitmap.createScaledBitmap(crop,(crop.width*scale).toInt().coerceAtLeast(1),(crop.height*scale).toInt().coerceAtLeast(1),true) else crop
    if(resized!==crop)crop.recycle()
    val output=ByteArrayOutputStream()
    resized.compress(Bitmap.CompressFormat.JPEG,55,output)
    resized.recycle()
    val jpeg=output.toByteArray()
    if(jpeg.isNotEmpty()&&jpeg.size<=3_750_000){
     payload.put("imageMimeType","image/jpeg").put("imageBase64",Base64.encodeToString(jpeg,Base64.NO_WRAP))
     lastImageUploadAt=now
    }
   }catch(e:Exception){android.util.Log.w("BrokerVision","Optional chart image encoding failed: ${e.message}")}
  }
  Thread{
   var c:HttpURLConnection?=null
   try{
    val body=payload.toString().toByteArray(Charsets.UTF_8)
    c=(URL("$endpoint/api/vision/frame").openConnection() as HttpURLConnection).apply{
     requestMethod="POST";connectTimeout=2500;readTimeout=2500;doOutput=true;useCaches=false
     setRequestProperty("Content-Type","application/json");setRequestProperty("Authorization","Bearer $token")
     setFixedLengthStreamingMode(body.size)
    }
    c.outputStream.use{it.write(body)}
    val code=c.responseCode
    val stream=if(code in 200..299)c.inputStream else c.errorStream
    val response=stream?.bufferedReader()?.use{it.readText()}.orEmpty()
    if(code in 200..299)android.util.Log.i("BrokerVision","Frame accepted HTTP $code: $response")
    else android.util.Log.w("BrokerVision","Frame rejected HTTP $code: $response")
   }catch(e:Exception){android.util.Log.w("BrokerVision","Upload failed: ${e.message}")}
   finally{c?.disconnect();uploading.set(false);busy.set(false)}
  }.start()
 }
 override fun onDestroy(){try{display?.release()}catch(_:Exception){};try{reader?.close()}catch(_:Exception){}
  try{projection?.stop()}catch(_:Exception){};try{recognizer.close()}catch(_:Exception){}
  worker?.quitSafely();super.onDestroy()
 }
}