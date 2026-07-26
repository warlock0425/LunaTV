package tv.berserker.client

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.Context
import android.graphics.Color
import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity

/**
 * BerserkerTV 的 Android TV 客戶端。
 *
 * 這是一層薄的 WebView 外殼：所有功能（搜尋、追更、播放紀錄、收藏）都直接
 * 使用你自架的站台，因此電視上的行為與手機／桌機完全一致，不會有版本落差，
 * 觀看紀錄也是同一份資料。
 *
 * 遙控器的方向鍵會原封不動傳給網頁，由站台內建的空間導航處理
 * （見 src/lib/spatial-navigation.ts）。
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView

    private val prefs by lazy {
        getSharedPreferences("berserkertv", Context.MODE_PRIVATE)
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )
            setBackgroundColor(Color.BLACK)

            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true // 播放紀錄／設定需要 localStorage
                databaseEnabled = true
                mediaPlaybackRequiresUserGesture = false // 電視上不該要求先點一下才能播
                loadWithOverviewMode = true
                useWideViewPort = true
                cacheMode = WebSettings.LOAD_DEFAULT
                mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            }

            webChromeClient = WebChromeClient()
            webViewClient = object : WebViewClient() {
                // 站內連結留在 App 內開啟
                override fun shouldOverrideUrlLoading(
                    view: WebView,
                    request: WebResourceRequest,
                ): Boolean = false
            }

            isFocusable = true
            isFocusableInTouchMode = true
        }

        setContentView(webView)

        val saved = prefs.getString(KEY_SERVER_URL, null)
        if (saved.isNullOrBlank()) {
            promptForServerUrl(initial = true)
        } else {
            load(saved)
        }
    }

    private fun load(url: String) {
        // 加上 tv=1，讓站台明確啟用遙控器導航（不必倚賴 UA 偵測）
        val separator = if (url.contains("?")) "&" else "?"
        webView.loadUrl("$url${separator}tv=1")
        webView.requestFocus()
    }

    /** 首次啟動或使用者要更換伺服器時，詢問站台網址 */
    private fun promptForServerUrl(initial: Boolean) {
        val input = EditText(this).apply {
            hint = getString(R.string.server_url_hint)
            setText(prefs.getString(KEY_SERVER_URL, "https://"))
            setSingleLine()
        }
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 24, 48, 0)
            addView(input)
        }

        AlertDialog.Builder(this)
            .setTitle(R.string.server_url_title)
            .setMessage(R.string.server_url_message)
            .setView(container)
            .setCancelable(!initial)
            .setPositiveButton(R.string.confirm) { _, _ ->
                val url = input.text.toString().trim().trimEnd('/')
                if (url.isBlank() || !url.startsWith("http")) {
                    Toast.makeText(this, R.string.server_url_invalid, Toast.LENGTH_LONG).show()
                    promptForServerUrl(initial)
                    return@setPositiveButton
                }
                prefs.edit().putString(KEY_SERVER_URL, url).apply()
                load(url)
            }
            .apply { if (!initial) setNegativeButton(R.string.cancel, null) }
            .show()
    }

    /**
     * 遙控器按鍵處理。
     *
     * 返回鍵：優先在網頁內回上一頁，沒有上一頁才離開 App——否則使用者從
     * 播放頁按返回會直接關掉整個應用程式。
     */
    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK && webView.canGoBack()) {
            webView.goBack()
            return true
        }
        // 選單鍵：更換伺服器位址（換機或改網域時不必重裝）
        if (keyCode == KeyEvent.KEYCODE_MENU) {
            promptForServerUrl(initial = false)
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onPause() {
        super.onPause()
        webView.onPause()
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
        webView.visibility = View.VISIBLE
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }

    private companion object {
        const val KEY_SERVER_URL = "server_url"
    }
}
