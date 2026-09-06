package com.bedenotvet.training;
import android.app.*;import android.os.*;import android.webkit.*;import android.view.*;import android.graphics.Color;
public class MainActivity extends Activity{
  WebView web;
  // CHANGE THIS to the address of your server. For same Wi-Fi use e.g. http://192.168.1.10:3000
  String SERVER_URL="http://192.168.1.10:3000";
  @Override public void onCreate(Bundle b){super.onCreate(b); web=new WebView(this); web.setBackgroundColor(Color.WHITE); WebSettings s=web.getSettings();s.setJavaScriptEnabled(true);s.setDomStorageEnabled(true);s.setAllowFileAccess(true);web.setWebViewClient(new WebViewClient());setContentView(web);web.loadUrl(SERVER_URL);}
  @Override public void onBackPressed(){if(web.canGoBack())web.goBack();else super.onBackPressed();}
}
