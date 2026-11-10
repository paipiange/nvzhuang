package com.paipiange.nvzhuang;

import android.annotation.SuppressLint;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AppCompatActivity;

import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

public class MainActivity extends AppCompatActivity {

    private static final String TAG = "MainActivity";
    private static final String LOCAL_HOST = "appassets.androidplatform.net";
    private static final String ASSETS_DIR = "www";

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;

    private final ActivityResultLauncher<String> filePickerLauncher =
            registerForActivityResult(new ActivityResultContracts.GetMultipleContents(), uris -> {
                if (filePathCallback != null) {
                    if (uris != null && !uris.isEmpty()) {
                        filePathCallback.onReceiveValue(uris.toArray(new Uri[0]));
                    } else {
                        filePathCallback.onReceiveValue(null);
                    }
                    filePathCallback = null;
                }
            });

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        webView = findViewById(R.id.webview);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (uri != null && LOCAL_HOST.equalsIgnoreCase(uri.getHost())) {
                    return handleLocalAsset(uri.getPath());
                }
                return super.shouldInterceptRequest(view, request);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                super.onReceivedError(view, request, error);
                if (request.isForMainFrame()) {
                    Log.e(TAG, "WebView error on main frame: " + error.getDescription() + " (" + error.getErrorCode() + ")");
                }
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback,
                                             FileChooserParams fileChooserParams) {
                if (MainActivity.this.filePathCallback != null) {
                    MainActivity.this.filePathCallback.onReceiveValue(null);
                }
                MainActivity.this.filePathCallback = filePathCallback;

                try {
                    filePickerLauncher.launch("image/*");
                    return true;
                } catch (Exception e) {
                    MainActivity.this.filePathCallback = null;
                    return false;
                }
            }
        });

        // 加载本地虚拟域名入口页面
        webView.loadUrl("https://" + LOCAL_HOST + "/index.html");

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (webView.canGoBack()) {
                    webView.goBack();
                } else {
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                }
            }
        });
    }

    /**
     * 拦截本地资产请求，从 assets/www/ 读取并注入正确的 MIME 和 CORS 头
     */
    private WebResourceResponse handleLocalAsset(String path) {
        if (path == null || path.isEmpty() || "/".equals(path)) {
            path = "/index.html";
        }
        if (path.startsWith("/")) {
            path = path.substring(1);
        }

        String assetPath = ASSETS_DIR + "/" + path;
        InputStream is = null;
        try {
            is = getAssets().open(assetPath);
        } catch (IOException e) {
            // 如果请求不是具体文件（如静态资源），支持 SPA 前端路由回退到 index.html
            if (!path.contains(".")) {
                try {
                    assetPath = ASSETS_DIR + "/index.html";
                    is = getAssets().open(assetPath);
                } catch (IOException ignored) {
                }
            }
        }

        if (is == null) {
            Log.w(TAG, "Asset not found: " + assetPath);
            return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", null, null);
        }

        String mimeType = getMimeType(assetPath);
        Map<String, String> headers = new HashMap<>();
        headers.put("Access-Control-Allow-Origin", "*");
        headers.put("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
        headers.put("Access-Control-Allow-Headers", "*");

        return new WebResourceResponse(mimeType, "UTF-8", 200, "OK", headers, is);
    }

    private String getMimeType(String path) {
        String lower = path.toLowerCase();
        if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html";
        if (lower.endsWith(".js") || lower.endsWith(".mjs")) return "text/javascript";
        if (lower.endsWith(".css")) return "text/css";
        if (lower.endsWith(".json")) return "application/json";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".gif")) return "image/gif";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".ico")) return "image/x-icon";
        if (lower.endsWith(".woff")) return "font/woff";
        if (lower.endsWith(".woff2")) return "font/woff2";
        if (lower.endsWith(".ttf")) return "font/ttf";
        if (lower.endsWith(".otf")) return "font/otf";
        if (lower.endsWith(".mp3")) return "audio/mpeg";
        if (lower.endsWith(".mp4")) return "video/mp4";
        return "application/octet-stream";
    }
}
