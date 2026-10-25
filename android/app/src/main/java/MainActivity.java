package org.johnsolomon.familytv;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

/** Family TV for TVs and projectors: the family streaming site, full screen, driven by the remote. */
public class MainActivity extends Activity {
    private static final String HOME = "https://johnsolomon.org/stream/?tv=1";
    private WebView web;
    private View fullView;
    private FrameLayout root;

    @Override protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);   // no screensaver mid-episode
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        root.addView(web);
        setContentView(root);
        hideBars();

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);                    // remembers the device sign-in and progress
        s.setMediaPlaybackRequiresUserGesture(false);    // next episode starts on its own
        s.setUserAgentString(s.getUserAgentString() + " FamilyTV-TV");   // tells the site to use TV mode
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if ("johnsolomon.org".equals(u.getHost())) return false;    // stay inside the app
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) {}
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {   // let the player go full screen if it asks
            @Override public void onShowCustomView(View view, CustomViewCallback cb) {
                fullView = view; root.addView(view); web.setVisibility(View.GONE); hideBars();
            }
            @Override public void onHideCustomView() {
                if (fullView != null) { root.removeView(fullView); fullView = null; }
                web.setVisibility(View.VISIBLE); hideBars();
            }
        });
        if (saved != null) web.restoreState(saved); else web.loadUrl(HOME);
        web.requestFocus();
    }

    private void hideBars() {
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
    }

    // Back on the remote: the site closes the player, the episode list or a category first;
    // only on Home does the app itself close.
    @Override public boolean dispatchKeyEvent(KeyEvent e) {
        if (e.getKeyCode() == KeyEvent.KEYCODE_BACK) {
            if (e.getAction() == KeyEvent.ACTION_UP) {
                web.evaluateJavascript("(window.ftvBack && window.ftvBack()) ? 1 : 0", v -> { if (!"1".equals(v)) finish(); });
            }
            return true;
        }
        return super.dispatchKeyEvent(e);
    }

    @Override protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }
    @Override protected void onResume() { super.onResume(); web.onResume(); hideBars(); }
    @Override protected void onPause() { web.evaluateJavascript("try{video.pause()}catch(e){}", null); web.onPause(); super.onPause(); }
    @Override public void onWindowFocusChanged(boolean f) { super.onWindowFocusChanged(f); if (f) hideBars(); }
}
