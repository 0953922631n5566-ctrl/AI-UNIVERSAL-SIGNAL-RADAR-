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
import java.util.concurrent.atomic.AtomicBoolean

class CaptureService:Service() {
 companion object {
  const val ACTION_START="com.universalbrokervision.START"
  const val EXTRA_RESULT_CODE="resultCode";const val EXTRA_RESULT_DATA="resultData"
  const val EXTRA_ENDPOINT="endpoint";const val EXTRA_TOKEN="token"
  private const val CHANNEL="broker_vision_capture";private const val NOTIFICATION_ID=901
 }
 private var projection:MediaProjection?=null;private var display:VirtualDisplay?=null;private var reader:ImageReader?=null
 private var worker:HandlerThread?=null;private var handler:Handler?=null;private var endpoint="";private var token=""
 private var lastAt=0L;private val busy=AtomicBoolean(false)
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
   if(System.currentTimeMillis()-lastAt<900||!busy.compareAndSet(false,true)){image.close();return@setOnImageAvailableListener}
   lastAt=System.currentTimeMillis();process(image)
  },handler)
  projection?.registerCallback(object:MediaProjection.Callback(){override fun onStop(){stopSelf()}},handler)
  display=projection?.createVirtualDisplay("BrokerVisionDisplay",metrics.widthPixels,metrics.heightPixels,metrics.densityDpi,
   DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,reader?.surface,null,handler)
 }
 private fun process(image:Image){
  try {
   val bitmap=toBitmap(image);image.close()
   recognizer.process(InputImage.fromBitmap(bitmap,0)).addOnSuccessListener{result->
    val chartLines=result.textBlocks.flatMap{it.lines}.filter{line->
     val box=line.boundingBox
     box!=null && box.left>bitmap.width*.08f && box.right<bitmap.width*.93f &&
      box.top>bitmap.height*.10f && box.bottom<bitmap.height*.92f
    }
    val ocr=JSONArray()
    chartLines.forEach{line->val box=line.boundingBox
     ocr.put(JSONObject().put("text",line.text).put("left",box?.left?:0).put("top",box?.top?:0).put("right",box?.right?:0).put("bottom",box?.bottom?:0))
    }
    val pricePattern=Regex("""\b\d+\.\d{3,8}\b""")
    val priceCandidates=chartLines.mapNotNull{line->
     val box=line.boundingBox
     val value=pricePattern.findAll(line.text.replace(",","")).lastOrNull()?.value?.toDoubleOrNull()
     if(box!=null && box.left>bitmap.width*.65f && box.top>bitmap.height*.12f && box.top<bitmap.height*.78f && value!=null)
      Triple(value,box.left,box.top) else null
    }
    val price=priceCandidates.maxByOrNull{it.second}?.first
    val headerText=chartLines.filter{line->val box=line.boundingBox;box!=null&&box.left<bitmap.width*.65f&&box.top<bitmap.height*.32f}
     .joinToString(" "){it.text}
    val pairPattern=Regex("""[A-Z]{3}\s*/\s*[A-Z]{3}(?:\s*\(OTC\))?""")
    val pair=pairPattern.find(headerText)?.value?.replace(" ","")
    val genericTicker=headerText.split(Regex("""\s+""")).map{it.trim().uppercase()}
     .firstOrNull{it.matches(Regex("""[A-Z0-9._/-]{2,12}(?:\(OTC\))?"""))&&it !in setOf("OTC","BLITZ","CALL","PUT","M1","M5")}
    val symbol=pair?:genericTicker?:"UNKNOWN"
    val timeframe=Regex("""(?i)\b(?:[1-9]\d?)(?:s|m|h|d)\b""").find(chartLines.joinToString(" "){it.text})?.value?.uppercase()?:"UNKNOWN"
    val payload=JSONObject().put("width",bitmap.width).put("height",bitmap.height).put("deviceTime",System.currentTimeMillis())
     .put("symbol",symbol).put("timeframe",timeframe).put("price",price).put("ocr",ocr).put("candles",detectCandles(bitmap))
     .put("chart",JSONObject().put("capture","full-screen"))
    upload(payload);bitmap.recycle()
   }.addOnFailureListener{bitmap.recycle()}.addOnCompleteListener{busy.set(false)}
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
   val high=g.minOf{it.top};val low=g.maxOf{it.bottom};val color=g.first().color
   out.put(JSONObject().put("x",g.map{it.x}.average()).put("color",color)
    .put("openY",if(color=="GREEN")low else high).put("closeY",if(color=="GREEN")high else low)
    .put("highY",high).put("lowY",low).put("bodyHeight",low-high))
  };return out
 }
 private fun upload(payload:JSONObject){Thread{
  var c:HttpURLConnection?=null
  try{c=(URL("$endpoint/api/vision/frame").openConnection() as HttpURLConnection).apply{
   requestMethod="POST";connectTimeout=8000;readTimeout=8000;doOutput=true
   setRequestProperty("Content-Type","application/json");setRequestProperty("Authorization","Bearer $token")
  };c.outputStream.use{it.write(payload.toString().toByteArray(Charsets.UTF_8))};c.inputStream.close()
  }catch(e:Exception){android.util.Log.w("BrokerVision","Upload failed: ${e.message}")}finally{c?.disconnect()}
 }.start()}
 override fun onDestroy(){try{display?.release()}catch(_:Exception){};try{reader?.close()}catch(_:Exception){}
  try{projection?.stop()}catch(_:Exception){};try{recognizer.close()}catch(_:Exception){}
  worker?.quitSafely();super.onDestroy()
 }
}