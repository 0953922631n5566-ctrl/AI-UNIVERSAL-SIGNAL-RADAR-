package com.kawasaki.visualsignalai;
import android.app.*;
import android.content.*;
import android.media.projection.MediaProjectionManager;
import android.net.Uri;
import android.os.*;
import android.provider.Settings;
import android.view.Gravity;
import android.widget.TextView;

public class MainActivity extends Activity {
 private static final int REQ_CAPTURE=701;
 private boolean captureConsentRequested=false;

 @Override public void onCreate(Bundle state) {
  super.onCreate(state);
  getWindow().setStatusBarColor(0xff101318);
  getWindow().setNavigationBarColor(0xff101318);
  TextView t=new TextView(this);
  t.setText("VISUAL-SIGNAL-AI\\n\\nAllow display capture, then use the floating button to analyze one screenshot.");
  t.setTextColor(0xffffffff); t.setTextSize(18); t.setGravity(Gravity.CENTER);
  t.setPadding(28,28,28,28); t.setBackgroundColor(0xff101318); setContentView(t);
  if(Build.VERSION.SDK_INT>=33 && checkSelfPermission("android.permission.POST_NOTIFICATIONS")!=0)
   requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"},702);
  if(!Settings.canDrawOverlays(this)) {
   startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,Uri.parse("package:"+getPackageName())));
   return;
  }
  requestCaptureConsent();
 }
 @Override protected void onResume() {
  super.onResume();
  if(!captureConsentRequested && Settings.canDrawOverlays(this)) requestCaptureConsent();
 }
 private void requestCaptureConsent() {
  if(captureConsentRequested)return;
  captureConsentRequested=true;
  startActivityForResult(((MediaProjectionManager)getSystemService(MEDIA_PROJECTION_SERVICE)).createScreenCaptureIntent(),REQ_CAPTURE);
 }
 @Override protected void onActivityResult(int request,int result,Intent data) {
  super.onActivityResult(request,result,data);
  if(request==REQ_CAPTURE && result==RESULT_OK && data!=null) {
   Intent service=new Intent(this,CaptureOverlayService.class);
   service.putExtra("resultCode",result); service.putExtra("projectionData",data);
   if(Build.VERSION.SDK_INT>=26) startForegroundService(service); else startService(service);
  }
 }
}
