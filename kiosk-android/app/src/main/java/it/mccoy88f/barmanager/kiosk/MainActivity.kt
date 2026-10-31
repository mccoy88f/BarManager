package it.mccoy88f.barmanager.kiosk

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.net.Uri
import android.net.http.SslError
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.webkit.SslErrorHandler
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : AppCompatActivity() {

    private val activityScope = CoroutineScope(Dispatchers.Main + Job())
    private var pollingJob: Job? = null
    private var heartbeatJob: Job? = null

    private lateinit var webContainer: FrameLayout
    private lateinit var webView: WebView
    private lateinit var errorOverlay: View
    private lateinit var btnRetry: Button

    private lateinit var pairingContainer: ScrollView
    private lateinit var tvCode: TextView
    private lateinit var tvStatus: TextView
    private lateinit var tvDeviceInfo: TextView
    private lateinit var btnServerSettings: Button
    private lateinit var btnRefreshCode: Button
    private lateinit var touchSecretCorner: View

    private var secretCornerTapCount = 0
    private var lastSecretTapTime = 0L

    private val retryHandler = Handler(Looper.getMainLooper())
    private var retryRunnable: Runnable? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Schermo sempre acceso (kiosk / display promo per locali)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        setImmersiveSticky()

        setContentView(R.layout.activity_main)

        initViews()
        setupListeners()
        setupWebView()

        if (KioskPrefs.isPaired(this)) {
            showWebViewMode(KioskPrefs.getScreenUrl(this)!!)
        } else {
            showPairingMode()
        }
    }

    override fun onResume() {
        super.onResume()
        setImmersiveSticky()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) {
            setImmersiveSticky()
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        pollingJob?.cancel()
        heartbeatJob?.cancel()
        retryRunnable?.let { retryHandler.removeCallbacks(it) }
        try {
            webView.destroy()
        } catch (_: Exception) {}
    }

    @Suppress("DEPRECATION")
    private fun setImmersiveSticky() {
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_FULLSCREEN
        )
    }

    private fun initViews() {
        webContainer = findViewById(R.id.webContainer)
        webView = findViewById(R.id.webView)
        errorOverlay = findViewById(R.id.errorOverlay)
        btnRetry = findViewById(R.id.btnRetry)

        pairingContainer = findViewById(R.id.pairingContainer)
        tvCode = findViewById(R.id.tvCode)
        tvStatus = findViewById(R.id.tvStatus)
        tvDeviceInfo = findViewById(R.id.tvDeviceInfo)
        btnServerSettings = findViewById(R.id.btnServerSettings)
        btnRefreshCode = findViewById(R.id.btnRefreshCode)
        touchSecretCorner = findViewById(R.id.touchSecretCorner)
    }

    private fun setupListeners() {
        btnServerSettings.setOnClickListener { showServerSettingsDialog() }
        btnRefreshCode.setOnClickListener { requestNewPairingCode() }
        btnRetry.setOnClickListener {
            errorOverlay.visibility = View.GONE
            val url = KioskPrefs.getScreenUrl(this)
            if (!url.isNullOrBlank()) {
                webView.loadUrl(url)
            }
        }

        // Tocco segreto in alto a destra: 5 tap rapidi aprono il menu admin
        touchSecretCorner.setOnClickListener {
            val now = System.currentTimeMillis()
            if (now - lastSecretTapTime < 1000) {
                secretCornerTapCount++
                if (secretCornerTapCount >= 5) {
                    secretCornerTapCount = 0
                    showKioskAdminMenu()
                }
            } else {
                secretCornerTapCount = 1
            }
            lastSecretTapTime = now
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.mediaPlaybackRequiresUserGesture = false // Autoplay video promo senza tocco
        settings.allowFileAccess = true
        settings.allowContentAccess = true
        settings.cacheMode = WebSettings.LOAD_DEFAULT

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        }

        webView.webChromeClient = WebChromeClient()

        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                errorOverlay.visibility = View.GONE
            }

            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                super.onReceivedError(view, request, error)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP && request?.isForMainFrame == true) {
                    scheduleRetry()
                }
            }

            @Suppress("DEPRECATION")
            override fun onReceivedError(view: WebView?, errorCode: Int, description: String?, failingUrl: String?) {
                super.onReceivedError(view, errorCode, description, failingUrl)
                scheduleRetry()
            }

            @SuppressLint("WebViewClientOnReceivedSslError")
            override fun onReceivedSslError(view: WebView?, handler: SslErrorHandler?, error: SslError?) {
                val url = error?.url ?: view?.url ?: ""
                val serverHost = Uri.parse(KioskPrefs.getServerUrl(this@MainActivity)).host ?: "mccoy88f.link"
                // Risolve il problema del certificato Let's Encrypt ISRG Root X1 su Android 6
                if (url.contains(serverHost) || url.contains("mccoy88f.link") || url.contains("localhost")) {
                    handler?.proceed()
                    return
                }
                super.onReceivedSslError(view, handler, error)
            }
        }

        // Pressione prolungata (3 secondi) sullo schermo per aprire il menu kiosk
        webView.setOnLongClickListener {
            showKioskAdminMenu()
            true
        }
    }

    private fun scheduleRetry() {
        errorOverlay.visibility = View.VISIBLE
        retryRunnable?.let { retryHandler.removeCallbacks(it) }
        retryRunnable = Runnable {
            val url = KioskPrefs.getScreenUrl(this)
            if (!url.isNullOrBlank() && KioskPrefs.isPaired(this)) {
                webView.loadUrl(url)
            }
        }
        retryHandler.postDelayed(retryRunnable!!, 5000L)
    }

    // ---- Modalità Schermo Promo (WebView) -----------------------------------

    private fun showWebViewMode(url: String) {
        pollingJob?.cancel()
        pollingJob = null

        pairingContainer.visibility = View.GONE
        webContainer.visibility = View.VISIBLE
        errorOverlay.visibility = View.GONE

        webView.loadUrl(url)
        startHeartbeatLoop()
    }

    /**
     * Heartbeat periodico verso il backend:
     * - Segnala lo stato "online" del dispositivo visibile all'admin.
     * - Se l'admin scollega lo schermo dal backoffice, il dispositivo torna automaticamente al codice di abbinamento.
     */
    private fun startHeartbeatLoop() {
        heartbeatJob?.cancel()
        heartbeatJob = activityScope.launch(Dispatchers.IO) {
            val deviceId = KioskPrefs.getDeviceId(this@MainActivity)
            while (isActive) {
                delay(45_000L) // Ogni 45 secondi
                val serverUrl = KioskPrefs.getServerUrl(this@MainActivity)
                val code = KioskPrefs.getPairingCode(this@MainActivity)
                val result = KioskApiClient.sendHeartbeat(serverUrl, code, deviceId)

                if (result.status == "UNPAIRED") {
                    withContext(Dispatchers.Main) {
                        Toast.makeText(this@MainActivity, "Schermo scollegato dal pannello", Toast.LENGTH_LONG).show()
                        KioskPrefs.clearPairing(this@MainActivity)
                        showPairingMode()
                    }
                    break
                }
            }
        }
    }

    // ---- Modalità Abbinamento (Codice su schermo) --------------------------

    private fun showPairingMode() {
        heartbeatJob?.cancel()
        heartbeatJob = null

        webContainer.visibility = View.GONE
        pairingContainer.visibility = View.VISIBLE

        updateDeviceInfoText()
        startPairingProcess()
    }

    private fun updateDeviceInfoText() {
        val server = KioskPrefs.getServerUrl(this)
        val ip = SystemInfo.getLocalIpAddress() ?: "N/D"
        val info = SystemInfo.getDeviceInfo()
        tvDeviceInfo.text = "Dispositivo: $info\nIP: $ip • Server: $server"
    }

    private fun startPairingProcess(forceNewCode: Boolean = false) {
        pollingJob?.cancel()
        tvStatus.text = getString(R.string.waiting_pairing)

        val cachedCode = if (forceNewCode) null else KioskPrefs.getPairingCode(this)
        if (!cachedCode.isNullOrBlank()) {
            displayCode(cachedCode)
        }

        pollingJob = activityScope.launch(Dispatchers.IO) {
            val serverUrl = KioskPrefs.getServerUrl(this@MainActivity)
            val deviceId = KioskPrefs.getDeviceId(this@MainActivity)
            val deviceInfo = SystemInfo.getDeviceInfo()
            val appVer = SystemInfo.getAppVersion(this@MainActivity)

            // Registra il dispositivo o recupera codice
            val regResult = KioskApiClient.register(
                serverUrl = serverUrl,
                deviceId = deviceId,
                deviceInfo = deviceInfo,
                appVersion = appVer,
                preferredCode = if (forceNewCode) null else cachedCode,
            )

            if (regResult.status == "PAIRED" && !regResult.screenUrl.isNullOrBlank()) {
                withContext(Dispatchers.Main) {
                    KioskPrefs.savePairing(
                        context = this@MainActivity,
                        screenId = regResult.screenId ?: "",
                        screenName = regResult.screenName,
                        screenUrl = regResult.screenUrl,
                        code = regResult.code ?: "",
                    )
                    showWebViewMode(regResult.screenUrl)
                }
                return@launch
            }

            val activeCode = regResult.code ?: cachedCode ?: "------"
            KioskPrefs.setPairingCode(this@MainActivity, activeCode)

            withContext(Dispatchers.Main) {
                displayCode(activeCode)
            }

            // Loop di polling finché non viene abbinato
            while (isActive) {
                delay(regResult.pollIntervalMs)
                val check = KioskApiClient.checkStatus(serverUrl, activeCode, deviceId)

                if (check.status == "PAIRED" && !check.screenUrl.isNullOrBlank()) {
                    withContext(Dispatchers.Main) {
                        tvStatus.text = "Collegato con successo!"
                        KioskPrefs.savePairing(
                            context = this@MainActivity,
                            screenId = check.screenId ?: "",
                            screenName = check.screenName,
                            screenUrl = check.screenUrl,
                            code = activeCode,
                        )
                        showWebViewMode(check.screenUrl)
                    }
                    break
                } else if (check.status == "NOT_FOUND") {
                    // Codice scaduto o eliminato: rigenera
                    break
                }
            }
        }
    }

    private fun requestNewPairingCode() {
        tvCode.text = "------"
        KioskPrefs.setPairingCode(this, "")
        startPairingProcess(forceNewCode = true)
    }

    private fun displayCode(code: String) {
        val clean = code.uppercase().replace(" ", "")
        // Formatta a blocchi da 3 caratteri per alta leggibilità da TV (es. "AB1 2CD")
        tvCode.text = if (clean.length == 6) {
            "${clean.substring(0, 3)} ${clean.substring(3)}"
        } else {
            clean
        }
    }

    // ---- Menu Amministrazione Kiosk (Pressione prolungata / 5 tap / Telecomando) --

    private fun showKioskAdminMenu() {
        val screenName = KioskPrefs.getScreenName(this) ?: "Schermo non denominato"
        val screenUrl = KioskPrefs.getScreenUrl(this) ?: "Nessun URL configurato"
        val server = KioskPrefs.getServerUrl(this)

        val options = mutableListOf<String>()
        if (KioskPrefs.isPaired(this)) {
            options.add(getString(R.string.reload))
            options.add(getString(R.string.unpair))
        }
        options.add(getString(R.string.btn_server_settings))
        options.add(getString(R.string.close))

        AlertDialog.Builder(this)
            .setTitle(getString(R.string.options_title))
            .setMessage("Schermo: $screenName\nURL: $screenUrl\nServer: $server")
            .setItems(options.toTypedArray()) { dialog, which ->
                val choice = options[which]
                when (choice) {
                    getString(R.string.reload) -> {
                        webView.reload()
                    }
                    getString(R.string.unpair) -> {
                        confirmUnpair()
                    }
                    getString(R.string.btn_server_settings) -> {
                        showServerSettingsDialog()
                    }
                    getString(R.string.close) -> {
                        dialog.dismiss()
                    }
                }
            }
            .show()
    }

    private fun confirmUnpair() {
        AlertDialog.Builder(this)
            .setTitle(getString(R.string.unpair))
            .setMessage(getString(R.string.confirm_unpair_msg))
            .setPositiveButton(getString(R.string.unpair)) { _, _ ->
                activityScope.launch(Dispatchers.IO) {
                    val server = KioskPrefs.getServerUrl(this@MainActivity)
                    val code = KioskPrefs.getPairingCode(this@MainActivity)
                    val deviceId = KioskPrefs.getDeviceId(this@MainActivity)
                    KioskApiClient.unpairSelf(server, code, deviceId)

                    withContext(Dispatchers.Main) {
                        KioskPrefs.clearPairing(this@MainActivity)
                        showPairingMode()
                    }
                }
            }
            .setNegativeButton(getString(R.string.cancel), null)
            .show()
    }

    private fun showServerSettingsDialog() {
        val view = LayoutInflater.from(this).inflate(R.layout.dialog_server_settings, null)
        val etUrl = view.findViewById<EditText>(R.id.etServerUrl)
        etUrl.setText(KioskPrefs.getServerUrl(this))

        AlertDialog.Builder(this)
            .setTitle(getString(R.string.btn_server_settings))
            .setView(view)
            .setPositiveButton(getString(R.string.save)) { _, _ ->
                val newUrl = etUrl.text.toString().trim()
                if (newUrl.isNotBlank()) {
                    KioskPrefs.setServerUrl(this, newUrl)
                    updateDeviceInfoText()
                    Toast.makeText(this, "Server aggiornato: ${KioskPrefs.getServerUrl(this)}", Toast.LENGTH_SHORT).show()
                    if (!KioskPrefs.isPaired(this)) {
                        requestNewPairingCode()
                    }
                }
            }
            .setNegativeButton(getString(R.string.cancel), null)
            .show()
    }

    // Rileva tocco a 3 dita su smartphone e tablet per aprire comodamente le opzioni kiosk
    override fun dispatchTouchEvent(ev: MotionEvent?): Boolean {
        if (ev != null && ev.pointerCount >= 3 && ev.actionMasked == MotionEvent.ACTION_POINTER_DOWN) {
            showKioskAdminMenu()
            return true
        }
        return super.dispatchTouchEvent(ev)
    }

    // Gestione tasti telecomando Android TV (Menu / Back)
    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_MENU || keyCode == KeyEvent.KEYCODE_SETTINGS) {
            showKioskAdminMenu()
            return true
        }
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            // Impedisce la chiusura accidentale da telecomando: mostra opzioni
            showKioskAdminMenu()
            return true
        }
        return super.onKeyDown(keyCode, event)
    }
}

