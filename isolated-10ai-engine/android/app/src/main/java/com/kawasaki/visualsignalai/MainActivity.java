package com.kawasaki.visualsignalai;
import android.app.*;import android.content.*;import android.media.projection.*;import android.net.Uri;import android.os.*;import android.provider.Settings;import android.view.*;import android.widget.*;
public class MainActivity extends Activity {
 private static final int REQ_CAPTURE=701;
 @Override public void onCreate(Bundle b){super.onCreate(b);getWindow().setStatusBarColor(0xff101318);getWindow().setNavigationBarColor(0xff101318);
  TextView t=new TextView(this);t.setText("VISUAL-SIGNAL-AI\n\nAllow display capture, then use the floating button to analyze one screenshot.");t.setTextColor(0xffffffff);t.setTextSize(18);t.setGravity(Gravity.CENTER);t.setPadding(28,28,28,28);t.setBackgroundColor(0xff101318);setContentView(t);
  if(Build.VERSION.SDK_INT>=33&&checkSelfPermission("android.permission.POST_NOTIFICATIONS")!=0)requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"},702);
  if(!Settings.canDrawOverlays(this)){startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,Uri.parse("package:"+getPackageName())));return;}
  startActivityForResult((MediaProjectionManager)getSystemService(MEDIA_PROJECTION_SERVICE).createScreenCaptureIntent(),REQ_CAPTURE);
 }
 @Override protected void onActivityResult(int r,int c,Intent d){super.onActivityResult(r,c,d);if(r==REQ_CAPTURE&&c==RESULT_OK&&d!=null){
  Intent s=new Intent(this,CaptureOverlayService.class);s.putExtra("resultCode",c);s.putExtra("projectionData",d);
  if(Build.VERSION.SDK_INT>=26)startForegroundService(s);else startService(s);
 }}
}
