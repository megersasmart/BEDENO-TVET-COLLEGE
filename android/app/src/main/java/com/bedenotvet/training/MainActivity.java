package com.bedenotvet.training;

import android.app.Activity;
import android.os.Bundle;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.graphics.Color;

public class MainActivity extends Activity {

    WebView web;

    String SERVER_URL = "https://bedeno-tvet-college.onrender.com";

    @Override
    public void onCreate(Bundle b) {
        super.onCreate(b);

        web = new WebView(this);
        web.setBackgroundColor(Color.WHITE);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);

        web.setWebViewClient(new WebViewClient());

        setContentView(web);

        if (isOnline()) {
            web.loadUrl(SERVER_URL);
        } else {
            web.loadUrl("file:///android_asset/www/index.html");
        }
    }

    private boolean isOnline() {
        ConnectivityManager cm =
                (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);

        NetworkInfo info = cm.getActiveNetworkInfo();

        return info != null && info.isConnected();
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
