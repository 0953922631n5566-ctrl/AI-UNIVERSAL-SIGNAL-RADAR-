package com.kawasaki.visualsignalai;
import android.app.*;import android.content.*;import android.graphics.*;import android.graphics.drawable.GradientDrawable;import android.hardware.display.*;import android.media.*;import android.media.projection.*;import android.os.*;import android.view.*;import android.widget.*;import org.json.*;import java.io.*;import java.net.*;import java.nio.*;import android.util.Base64;import android.util.DisplayMetrics;
public class CaptureOverlayService extends Service {
 private WindowManager wm;private View button,bar;private MediaProjection projection;private Handler h=new Handler(Looper.getMainLooper());private int density,w,hh;private boolean busy=false,capturePending=false;private ImageReader imageReader;private VirtualDisplay virtualDisplay;private WindowManager.LayoutParams buttonLp;
 public IBinder onBind(Intent i){return null;}
 public int onStartCommand(Intent i,int flags,int id){
  createChannel();startForeground(19,new Notification.Builder(this,"visual_capture").setSmallIcon(android.R.drawable.ic_menu_camera).setContentTitle("VISUAL-SIGNAL-AI").setContentText("Manual screenshot capture is ready").build());
  Intent data=i.getParcelableExtra("projectionData");int code=i.getIntExtra("resultCode",0);
  projection=((MediaProjectionManager)getSystemService(MEDIA_PROJECTION_SERVICE)).getMediaProjection(code,data);
  if(projection==null){stopSelf();return START_NOT_STICKY;}
  projection.registerCallback(new MediaProjection.Callback(){@Override public void onStop(){stopSelf();}},h);
  showButton();initCapturePipeline();return START_STICKY;
 }
 private void createChannel(){if(Build.VERSION.SDK_INT>=26){NotificationManager n=getSystemService(NotificationManager.class);n.createNotificationChannel(new NotificationChannel("visual_capture","Visual capture",NotificationManager.IMPORTANCE_LOW));}}
 private int dp(float v){return (int)(v*getResources().getDisplayMetrics().density+.5f);}
 private void showButton(){wm=(WindowManager)getSystemService(WINDOW_SERVICE);DisplayMetrics m=new DisplayMetrics();wm.getDefaultDisplay().getRealMetrics(m);w=m.widthPixels;hh=m.heightPixels;density=m.densityDpi;
  TextView b=new TextView(this);b.setText("◎");b.setTextSize(27);b.setTextColor(Color.WHITE);b.setGravity(Gravity.CENTER);b.setBackground(round(0xee252a33,dp(30)));b.setElevation(dp(8));button=b;
  int type=Build.VERSION.SDK_INT>=26?WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY:WindowManager.LayoutParams.TYPE_PHONE;
  buttonLp=new WindowManager.LayoutParams(dp(58),dp(58),type,WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE|WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,PixelFormat.TRANSLUCENT);buttonLp.gravity=Gravity.TOP|Gravity.START;buttonLp.x=w-dp(78);buttonLp.y=hh/2;
  b.setOnTouchListener(new View.OnTouchListener(){float sx,sy;int ox,oy;boolean moved;
   public boolean onTouch(View v,android.view.MotionEvent e){if(e.getAction()==0){sx=e.getRawX();sy=e.getRawY();ox=buttonLp.x;oy=buttonLp.y;moved=false;return true;}
    if(e.getAction()==2){float dx=e.getRawX()-sx,dy=e.getRawY()-sy;if(Math.abs(dx)+Math.abs(dy)>dp(6))moved=true;buttonLp.x=ox+(int)dx;buttonLp.y=oy+(int)dy;wm.updateViewLayout(button,buttonLp);return true;}
    if(e.getAction()==1){if(!moved)captureOneFrame();return true;}return true;}});
  wm.addView(button,buttonLp);
 }
 private GradientDrawable round(int color,int radius){GradientDrawable d=new GradientDrawable();d.setColor(color);d.setCornerRadius(radius);d.setStroke(dp(1),0x668c929d);return d;}
 private void initCapturePipeline(){
  imageReader=ImageReader.newInstance(w,hh,PixelFormat.RGBA_8888,3);
  imageReader.setOnImageAvailableListener(reader->{
   if(!capturePending||busy)return;
   Image image=null;
   try{
    image=reader.acquireLatestImage();if(image==null)return;
    capturePending=false;busy=true;
    Image.Plane plane=image.getPlanes()[0];ByteBuffer buf=plane.getBuffer();
    int pixel=plane.getPixelStride(),row=plane.getRowStride();
    Bitmap raw=Bitmap.createBitmap(row/pixel,hh,Bitmap.Config.ARGB_8888);raw.copyPixelsFromBuffer(buf);
    Bitmap bmp=Bitmap.createBitmap(raw,0,0,w,hh);raw.recycle();
    ByteArrayOutputStream out=new ByteArrayOutputStream();bmp.compress(Bitmap.CompressFormat.JPEG,82,out);bmp.recycle();
    byte[] bytes=out.toByteArray();new Thread(()->sendImage(bytes)).start();
   }catch(Exception ex){capturePending=false;busy=false;h.post(()->showStatus("STANDBY"));}
   finally{if(image!=null)image.close();}
  },h);
  virtualDisplay=projection.createVirtualDisplay("visual-signal-capture",w,hh,density,
    DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,imageReader.getSurface(),null,h);
 }
 private void captureOneFrame(){
  if(busy||capturePending||projection==null||virtualDisplay==null)return;
  capturePending=true;showStatus("STANDBY");
  h.postDelayed(()->{if(capturePending){capturePending=false;showStatus("STANDBY");}},4000);
 }
 private void sendImage(byte[] bytes){HttpURLConnection c=null;String state="STANDBY";try{
  URL u=new URL(BuildConfig.VISION_ENDPOINT);c=(HttpURLConnection)u.openConnection();c.setRequestMethod("POST");c.setConnectTimeout(12000);c.setReadTimeout(30000);c.setDoOutput(true);c.setRequestProperty("Content-Type","application/json");
  JSONObject body=new JSONObject();body.put("imageBase64",Base64.encodeToString(bytes,Base64.NO_WRAP));body.put("mimeType","image/jpeg");JSONObject ctx=new JSONObject();ctx.put("symbol","EUR/USD");ctx.put("timeframe","M1");body.put("chartContext",ctx);
  try(OutputStream os=c.getOutputStream()){os.write(body.toString().getBytes("UTF-8"));}
  int code=c.getResponseCode();InputStream in=code<400?c.getInputStream():c.getErrorStream();ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] b=new byte[4096];int n;while((n=in.read(b))>0)out.write(b,0,n);
  if(code==200)state=new JSONObject(out.toString("UTF-8")).optString("signal","STANDBY");
 }catch(Exception ignored){state="STANDBY";}finally{if(c!=null)c.disconnect();String result=state;h.post(()->{busy=false;showStatus(result);});}}
 private void showStatus(String state){if(bar!=null){try{wm.removeView(bar);}catch(Exception ignored){}bar=null;}
  int color="CALL".equals(state)?0xff16a34a:"PUT".equals(state)?0xffdc2626:0xff6b7280;
  View v=new View(this);v.setBackgroundColor(color);bar=v;int type=Build.VERSION.SDK_INT>=26?WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY:WindowManager.LayoutParams.TYPE_PHONE;
  WindowManager.LayoutParams p=new WindowManager.LayoutParams(-1,dp(5),type,WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE|WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE|WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,PixelFormat.TRANSLUCENT);p.gravity=Gravity.TOP;wm.addView(v,p);h.postDelayed(()->{if(bar==v){try{wm.removeView(v);}catch(Exception ignored){}bar=null;}},5000);
 }
 @Override public void onDestroy(){if(button!=null)try{wm.removeView(button);}catch(Exception ignored){}if(bar!=null)try{wm.removeView(bar);}catch(Exception ignored){}if(virtualDisplay!=null)virtualDisplay.release();if(imageReader!=null)imageReader.close();if(projection!=null)projection.stop();super.onDestroy();}
}
