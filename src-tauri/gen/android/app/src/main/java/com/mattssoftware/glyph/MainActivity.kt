package com.mattssoftware.glyph

import android.app.KeyguardManager
import android.app.role.RoleManager
import android.content.ActivityNotFoundException
import android.content.BroadcastReceiver
import android.content.ClipboardManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.view.View
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.exifinterface.media.ExifInterface
import org.json.JSONObject
import java.io.FileOutputStream
import java.util.Locale
import java.util.UUID
import com.mattssoftware.glyph.updates.UpdateAlerts
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * The one activity, and the door the side key comes in through.
 *
 * HAND-WRITTEN AND TRACKED. `tauri android init` would replace this with its
 * two-line template and never recreate what is below; `.gitignore` re-includes
 * it by name for that reason.
 *
 * Everything here is about one question - "was this a request to start
 * recording?" - and getting that answer to the page. A capture arrives two ways:
 * cold (Glyph was not running; the answer is read by the page as it boots) and
 * warm (Glyph was open or backgrounded; the answer is pushed to the page). Both
 * paths are needed because a `singleTask` activity receives a second launch as
 * `onNewIntent`, not `onCreate`, and a page that is already up will never ask.
 */
class MainActivity : TauriActivity() {
  companion object {
    /** Sent by `GlyphSession` when the side key is held, and by the launcher shortcut. */
    const val ACTION_CAPTURE = "com.mattssoftware.glyph.CAPTURE"
    const val EXTRA_SOURCE = "com.mattssoftware.glyph.SOURCE"
    private const val TAG = "GlyphCapture"
    private const val REQUEST_NOTIFICATIONS = 4101
    private const val REQUEST_PICTURE = 4102
    /** A picked picture is shrunk so its long side is at most this, as a JPEG. Plenty for a note; ~300 KB. */
    private const val PICTURE_MAX_PX = 1600
  }

  private var webView: WebView? = null

  /**
   * A capture request the page has not collected yet. Volatile because the page
   * reads it on the WebView's JavaBridge thread while this activity writes it
   * on the main thread.
   */
  @Volatile private var pendingLaunch: String? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    // Before super: the window's lock-screen behaviour has to be decided before
    // the window is shown, and super.onCreate is what shows it.
    takeCapture(intent)
    super.onCreate(savedInstanceState)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    if (takeCapture(intent)) deliverCapture()
  }

  /**
   * The notification permission answer, for update alerts. `super` first: Tauri's
   * plugins route their own permission results through this same callback.
   * The page is then told to re-read the switch, because `setUpdateAlerts`
   * returned before the person had answered.
   */
  /**
   * The picked picture, shrunk and rotated the right way up, written to
   * cacheDir/picked/ and announced to the page as `window.__glyph.image(json)`.
   * Rust then files it under the app's data (`save_image`); the cache copy is
   * the only thing this activity ever writes.
   */
  override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    super.onActivityResult(requestCode, resultCode, data)
    if (requestCode != REQUEST_PICTURE) return
    val uri = data?.data
    if (resultCode != RESULT_OK || uri == null) {
      tellPage(JSONObject().put("cancelled", true))
      return
    }
    Thread {
      val answer = try {
        JSONObject().put("path", shrinkPicture(uri).absolutePath)
      } catch (error: Exception) {
        Log.w(TAG, "picture not read", error)
        JSONObject().put("error", "That picture could not be read.")
      }
      tellPage(answer)
    }.start()
  }

  private fun tellPage(answer: JSONObject) {
    val wv = webView ?: return
    val script = "window.__glyph && window.__glyph.image && window.__glyph.image(${JSONObject.quote(answer.toString())})"
    runOnUiThread { wv.evaluateJavascript(script, null) }
  }

  /*
   * The hinge, streamed to the page while Glyph is up.
   *
   * The note screen draws its unfold from the angle (core/unfold.ts), so it
   * needs the angle as it changes, not the fold state after the fact. The
   * sensor is Android's own (TYPE_HINGE_ANGLE, degrees, 0 closed to 180 flat):
   * no permission, and a phone without one - every slab - answers null and
   * nothing here runs. Registered in onResume and dropped in onPause, so a
   * backgrounded Glyph is not woken fifty times a second by a hand opening
   * the phone for something else. Readings reach the page the way tellPage's
   * do, on the main thread, as `window.__glyph.hinge(degrees)`.
   */
  private val hinge: Sensor? by lazy {
    (getSystemService(SENSOR_SERVICE) as? SensorManager)?.getDefaultSensor(Sensor.TYPE_HINGE_ANGLE)
  }
  private var lastHinge = Float.NaN

  private val hingeListener = object : SensorEventListener {
    override fun onSensorChanged(event: SensorEvent) {
      val angle = event.values[0]
      // Half a degree is below anything the page draws; a sensor that
      // chatters in hundredths would otherwise post a script per tick.
      if (!lastHinge.isNaN() && kotlin.math.abs(angle - lastHinge) < 0.5f) return
      lastHinge = angle
      val wv = webView ?: return
      val script = "window.__glyph && window.__glyph.hinge && window.__glyph.hinge(${String.format(Locale.US, "%.1f", angle)})"
      runOnUiThread { wv.evaluateJavascript(script, null) }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
  }

  override fun onResume() {
    super.onResume()
    // Registered whether or not the WebView exists yet: on a cold start it
    // may not, and the listener drops readings until it does. Waiting for it
    // here would mean no hinge until the second resume.
    val sensor = hinge ?: return
    lastHinge = Float.NaN
    (getSystemService(SENSOR_SERVICE) as SensorManager).registerListener(hingeListener, sensor, SensorManager.SENSOR_DELAY_GAME)
  }

  override fun onPause() {
    (getSystemService(SENSOR_SERVICE) as? SensorManager)?.unregisterListener(hingeListener)
    super.onPause()
  }

  /**
   * The side key pressed during a recording, seen the only way an app can see
   * it: the screen going off.
   *
   * Android never gives an app the power key's press or release (it is kept
   * from every app so none can stop a phone turning off), and nothing lets an
   * app ask whether it is held. What an app CAN hear is ACTION_SCREEN_OFF,
   * which a quick press of the side key causes. So while a recording is going
   * the screen is kept on (FLAG_KEEP_SCREEN_ON, so a timeout never looks like
   * a press), and the screen going off means "stop": the page is told as
   * `window.__glyph.screenOff()` and saves the take the way Done does. The
   * receiver only exists while a recording does; `setCapturing` adds and
   * removes both. A held press does not turn the screen off, so letting go of
   * the hold that started the recording does not stop it.
   */
  private val screenOff = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      if (intent.action != Intent.ACTION_SCREEN_OFF) return
      val wv = webView ?: return
      runOnUiThread {
        // A paused WebView queues evaluateJavascript instead of running it
        // (see deliverCapture), and the screen going off pauses the activity.
        wv.onResume()
        wv.evaluateJavascript("window.__glyph && window.__glyph.screenOff ? (window.__glyph.screenOff(), 'ok') : 'no'", null)
      }
    }
  }
  private var capturing = false

  private fun setCapturingNow(on: Boolean) {
    if (on == capturing) return
    capturing = on
    if (on) {
      window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
      // Not exported: only the system sends SCREEN_OFF, and it has to be
      // registered at run time; a manifest entry is never delivered.
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        registerReceiver(screenOff, IntentFilter(Intent.ACTION_SCREEN_OFF), Context.RECEIVER_NOT_EXPORTED)
      } else {
        @Suppress("UnspecifiedRegisterReceiverFlag")
        registerReceiver(screenOff, IntentFilter(Intent.ACTION_SCREEN_OFF))
      }
    } else {
      window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
      try {
        unregisterReceiver(screenOff)
      } catch (_: IllegalArgumentException) {
        // Never registered: nothing to take back.
      }
    }
  }

  override fun onDestroy() {
    setCapturingNow(false)
    super.onDestroy()
  }

  /** Decodes `uri` at a sample size that keeps memory sane, rotates it per EXIF, caps the long side, writes a JPEG. */
  private fun shrinkPicture(uri: Uri): File {
    val resolver = contentResolver
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
    val longest = maxOf(bounds.outWidth, bounds.outHeight).coerceAtLeast(1)
    var sample = 1
    while (longest / (sample * 2) >= PICTURE_MAX_PX) sample *= 2
    val decoded = resolver.openInputStream(uri)?.use {
      BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample })
    } ?: throw IllegalStateException("decode failed")
    val rotation = resolver.openInputStream(uri)?.use { stream ->
      when (ExifInterface(stream).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
        ExifInterface.ORIENTATION_ROTATE_90 -> 90f
        ExifInterface.ORIENTATION_ROTATE_180 -> 180f
        ExifInterface.ORIENTATION_ROTATE_270 -> 270f
        else -> 0f
      }
    } ?: 0f
    val scale = minOf(1f, PICTURE_MAX_PX.toFloat() / maxOf(decoded.width, decoded.height))
    val matrix = Matrix().apply {
      if (scale < 1f) postScale(scale, scale)
      if (rotation != 0f) postRotate(rotation)
    }
    val upright = Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true)
    val dir = File(cacheDir, "picked").apply { mkdirs() }
    val out = File(dir, "${UUID.randomUUID()}.jpg")
    FileOutputStream(out).use { upright.compress(Bitmap.CompressFormat.JPEG, 85, it) }
    return out
  }

  override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults)
    if (requestCode != REQUEST_NOTIFICATIONS) return
    webView?.let { wv ->
      runOnUiThread { wv.evaluateJavascript("window.__glyph && window.__glyph.alerts && window.__glyph.alerts()", null) }
    }
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    this.webView = webView
    webView.addJavascriptInterface(GlyphHost(), "GlyphHost")
    fitAboveKeyboard(webView)
    /*
     * The back gesture, routed into the app instead of out of it.
     *
     * TauriActivity opts out of wry's own back handling (handleBackNavigation
     * = false), so with no callback of our own a back swipe fell through to the
     * framework default, finish(): the whole app closed from an open note. The
     * page is the only side that knows what is on screen - a note, the settings
     * page and a pane inside it, the guide - so the gesture is handed to it
     * (window.__glyph.back, core/back.ts), which steps back one screen and
     * answers true, or answers false at the list. At the list the app goes
     * behind the home screen like any other; it is never finished, so the
     * side key's next press finds it warm. The same shape as AttackFM's.
     */
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        val wv = this@MainActivity.webView
        if (wv == null) {
          moveTaskToBack(true)
          return
        }
        wv.evaluateJavascript("window.__glyph && window.__glyph.back ? window.__glyph.back() : false") { result ->
          // The JSON of the expression: "true" when the page used the gesture.
          // Anything else - false, null from a page still loading - is the root.
          if (result != "true") moveTaskToBack(true)
        }
      }
    })
  }

  private fun isCapture(intent: Intent?): Boolean =
    intent?.action == ACTION_CAPTURE || intent?.action == Intent.ACTION_ASSIST

  /**
   * Record the request and let this one launch show over the lock screen.
   *
   * Showing over the keyguard is granted per capture and taken back when it ends
   * (see `GlyphHost.endCapture`), never left on. A notes app that stayed visible
   * over the lock screen would hand every note to anyone holding the phone; a
   * capture screen that shows only the note being dictated does not.
   */
  private fun takeCapture(intent: Intent?): Boolean {
    if (!isCapture(intent)) return false
    pendingLaunch = "capture"
    setLockScreenCapture(true)
    return true
  }

  private fun setLockScreenCapture(on: Boolean) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(on)
      setTurnScreenOn(on)
    } else {
      @Suppress("DEPRECATION")
      val flags = WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
      if (on) window.addFlags(flags) else window.clearFlags(flags)
    }
  }

  /**
   * Push a warm capture to a page that is already running.
   *
   * The WebView is resumed first because a backgrounded one is paused, and a
   * paused WebView QUEUES evaluateJavascript rather than running it - AttackFM
   * measured that the hard way. The request is only cleared once the page says
   * it took it; if the page is mid-reload, it stays pending and the page
   * collects it through `takeLaunch` as it boots.
   */
  private fun deliverCapture() {
    val wv = webView ?: return
    runOnUiThread {
      wv.onResume()
      wv.evaluateJavascript(
        "window.__glyph && window.__glyph.capture ? (window.__glyph.capture(), 'ok') : 'no'",
      ) { result ->
        if (result == "\"ok\"") pendingLaunch = null
        else Log.i(TAG, "capture held: page not ready ($result)")
      }
    }
  }

  /**
   * The page ends where the keyboard begins.
   *
   * `enableEdgeToEdge` draws the page under the system bars, which the page
   * pads for itself (env(safe-area-inset-*)), and on Android 15 and later the
   * old `adjustResize` no longer shrinks an edge-to-edge window for the
   * keyboard. So the keyboard simply covered the note: a line tapped near the
   * bottom stayed under it, typing included (measured on the emulator), and
   * the caret could not be scrolled to. Now, while the keyboard is up, the
   * content frame is padded by its height, so the WebView is that much
   * shorter: the page sees an ordinary resize, and the editor keeps the caret
   * in view (editor/Editor.tsx). Native generation 15.
   */
  private fun fitAboveKeyboard(webView: WebView) {
    // On the frame around the WebView, never on the WebView itself: the WebView
    // listens for its own insets to give the page env(safe-area-inset-*), and a
    // listener set on it replaces that one (the header slid under the clock).
    // The insets go on down unchanged; only the frame's padding moves.
    val frame = (webView.parent as? View) ?: findViewById<View>(android.R.id.content) ?: return
    ViewCompat.setOnApplyWindowInsetsListener(frame) { view, insets ->
      val keyboard = if (insets.isVisible(WindowInsetsCompat.Type.ime())) insets.getInsets(WindowInsetsCompat.Type.ime()).bottom else 0
      if (view.paddingBottom != keyboard) view.setPadding(view.paddingLeft, view.paddingTop, view.paddingRight, keyboard)
      insets
    }
    ViewCompat.requestApplyInsets(frame)
  }

  /** The page's line to the activity. Every method is called on the JavaBridge thread. */
  inner class GlyphHost {
    /**
     * The status and navigation bar icons, dark on a light page or light on a
     * dark one. `enableEdgeToEdge` picks them from the phone's dark mode, so
     * Glyph's own Light or Dark setting left them white on white paper, or
     * black on black. The page calls this whenever its theme settles. Native
     * generation 15.
     */
    @JavascriptInterface
    fun setLightChrome(light: Boolean) {
      runOnUiThread {
        WindowCompat.getInsetsController(window, window.decorView).apply {
          isAppearanceLightStatusBars = light
          isAppearanceLightNavigationBars = light
        }
        // The text selection handles follow the app's theme, not the phone's: black on the light page, white on the
        // dark, each with its holographic sheen (res/drawable/glyph_handle_*). The WebView reads them from the
        // activity's theme as it draws a handle, so the next selection picks them up.
        theme.applyStyle(if (light) R.style.GlyphHandles_Ink else R.style.GlyphHandles_Paper, true)
      }
    }

    /** "capture" once, if a capture launch is waiting; otherwise "". */
    @JavascriptInterface
    fun takeLaunch(): String {
      val launch = pendingLaunch ?: ""
      pendingLaunch = null
      return launch
    }

    /**
     * Whether the phone is locked right now. The page asks before deciding
     * where to go when a capture ends: straight back to the lock screen, or on
     * into the note.
     */
    @JavascriptInterface
    fun isLocked(): Boolean =
      (getSystemService(KEYGUARD_SERVICE) as KeyguardManager).isKeyguardLocked

    /**
     * The capture is over. Withdraw the lock-screen permission, and when the
     * phone is locked, step back behind the keyguard so the saved note is not
     * left on display.
     */
    /**
     * A recording started or ended: keep the screen on while it runs, and
     * listen for it going off, which is the side key pressed to stop
     * (native generation 12).
     */
    @JavascriptInterface
    fun setCapturing(on: Boolean) {
      runOnUiThread { setCapturingNow(on) }
    }

    @JavascriptInterface
    fun endCapture(leave: Boolean) {
      runOnUiThread {
        setLockScreenCapture(false)
        if (leave) moveTaskToBack(true)
      }
    }

    /**
     * Whether Glyph is the digital assistant app. That is what pressing and
     * holding the side key opens once Samsung's side-key setting is on
     * "Digital assistant". The guide's side-key page asks this to show its
     * tick, and asks again when the person comes back from settings.
     *
     * On Android 10 and up this is the assistant role. Older versions have no
     * roles; there the assistant is the component in the secure "assistant"
     * setting. Reading that setting is wrapped because a settings key Android
     * has not made public can throw instead of returning null.
     */
    @JavascriptInterface
    fun isAssistant(): Boolean {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        val roles = getSystemService(RoleManager::class.java) ?: return false
        return roles.isRoleAvailable(RoleManager.ROLE_ASSISTANT) && roles.isRoleHeld(RoleManager.ROLE_ASSISTANT)
      }
      return try {
        val assistant = Settings.Secure.getString(contentResolver, "assistant") ?: return false
        ComponentName.unflattenFromString(assistant)?.packageName == packageName
      } catch (e: SecurityException) {
        false
      }
    }

    /**
     * Opens the settings screen closest to choosing the digital assistant
     * app. Returns true if a screen opened.
     *
     * An app cannot ask for the assistant role with a system dialog, the way it
     * can for the dialer or SMS roles, because that role is not requestable. So
     * the best Glyph can do is open the right settings page: voice input
     * settings, where stock Android puts the assistant choice, or the default
     * apps list, which every phone since Android 7 has. Starting the activity
     * happens on the main thread and the bridge thread waits for the result.
     * The page's JavaScript is blocked meanwhile, but the main thread never is.
     */
    @JavascriptInterface
    fun openAssistantSettings(): Boolean {
      val screens = listOf(Settings.ACTION_VOICE_INPUT_SETTINGS, Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS)
      val opened = AtomicBoolean(false)
      val done = CountDownLatch(1)
      runOnUiThread {
        try {
          opened.set(
            screens.any { action ->
              try {
                startActivity(Intent(action))
                true
              } catch (e: ActivityNotFoundException) {
                false
              }
            },
          )
        } finally {
          done.countDown()
        }
      }
      return done.await(2, TimeUnit.SECONDS) && opened.get()
    }

    /** `Build.MANUFACTURER`, e.g. "samsung", so the guide shows that maker's side-key steps. */
    @JavascriptInterface
    fun deviceMaker(): String = Build.MANUFACTURER ?: ""

    /**
     * Hand a downloaded APK to Android's package installer.
     *
     * The page cannot do this and Rust has no Context to do it with, so the
     * download and its SHA-256 check happen in Rust (`ota_fetch_apk`) and only
     * the last step is here. Android then shows its own "update this app?"
     * screen, which no sideloaded app can skip, and replaces the process.
     *
     * Only a file inside `cacheDir/updates` is accepted. This method is callable
     * by anything running in the page, and without the check it would be a way
     * to hand any readable file to a content URI.
     *
     * The first time, Android also wants Glyph allowed to install apps. That is
     * a settings page, not a prompt, so this opens it and answers "permission";
     * the page asks the person to come back and tap Install again.
     */
    /** Update alerts: "off", "on", or "blocked" (on, but notifications are not allowed). */
    @JavascriptInterface
    fun updateAlerts(): String = UpdateAlerts.state(this@MainActivity)

    /**
     * Turn update alerts on or off, answering the new state. Turning them on
     * where Android 13+ has not yet allowed notifications asks for that too;
     * the answer arrives later (onRequestPermissionsResult), so the page reads
     * "blocked" now and is told to look again.
     */
    @JavascriptInterface
    fun setUpdateAlerts(on: Boolean): String {
      if (!on) {
        UpdateAlerts.disable(this@MainActivity)
        return UpdateAlerts.state(this@MainActivity)
      }
      UpdateAlerts.enable(this@MainActivity)
      if (!UpdateAlerts.canNotify(this@MainActivity) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        runOnUiThread { requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), REQUEST_NOTIFICATIONS) }
      }
      return UpdateAlerts.state(this@MainActivity)
    }

    /**
     * Pictures (native generation 8): open the phone's picture picker. The
     * answer arrives later as an `image` event; see onActivityResult.
     */
    @JavascriptInterface
    fun pickImage(): String {
      val intent = Intent(Intent.ACTION_GET_CONTENT).setType("image/*").addCategory(Intent.CATEGORY_OPENABLE)
      return try {
        runOnUiThread { startActivityForResult(Intent.createChooser(intent, "Choose a picture"), REQUEST_PICTURE) }
        "started"
      } catch (error: ActivityNotFoundException) {
        "This phone has no picture picker."
      }
    }

    /**
     * What is on the clipboard, for the editor's own Paste (its press-and-hold
     * menu): the page cannot read the clipboard itself in the WebView. JSON:
     * `{ "text": … }` for words, `{ "path": … }` for a picture (shrunk and
     * turned the right way up into cacheDir/picked/, the way the picker does,
     * for `save_image` to adopt), `{ "error": … }` when a picture could not be
     * read, `{}` when there is nothing. Native generation 12.
     */
    @JavascriptInterface
    fun readClipboard(): String {
      // A page's call arrives on a binder thread, and the clipboard is the UI thread's to read: asked from here it
      // can come back empty or throw, and the note's Paste then did nothing at all. What is on it is taken on the UI
      // thread and waited for - briefly, and never from the UI thread itself, which would wait on work only it can
      // do. A picture is shrunk back here, off it.
      val clip =
        if (Looper.myLooper() == Looper.getMainLooper()) {
          clipboardNow()
        } else {
          val answer = java.util.concurrent.ArrayBlockingQueue<Array<String?>>(1)
          runOnUiThread { answer.offer(clipboardNow()) }
          answer.poll(500, java.util.concurrent.TimeUnit.MILLISECONDS)
        }
      if (clip == null) {
        Log.w(TAG, "clipboard read timed out")
        return "{}"
      }
      val uri = clip[0]?.let { Uri.parse(it) }
      if (uri != null && (contentResolver.getType(uri) ?: "").startsWith("image/")) {
        return try {
          JSONObject().put("path", shrinkPicture(uri).absolutePath).toString()
        } catch (error: Exception) {
          Log.w(TAG, "clipboard picture unreadable", error)
          JSONObject().put("error", "That picture couldn't be read from the clipboard.").toString()
        }
      }
      val text = clip[1].orEmpty()
      // Since Android 10 the clipboard only answers an app that holds focus, and a refusal reads as nothing at all:
      // logged so an empty paste can be told apart from an empty clipboard (logcat -s ClipboardService says which).
      if (text.isEmpty()) Log.i(TAG, "clipboard read came back empty (uri=${clip[0] != null})")
      return if (text.isEmpty()) "{}" else JSONObject().put("text", text).toString()
    }

    /** The first thing on the clipboard as `[uri, words]`, read on the UI thread where the clipboard belongs. */
    private fun clipboardNow(): Array<String?> {
      val empty = arrayOf<String?>(null, null)
      val clipboard = getSystemService(CLIPBOARD_SERVICE) as? ClipboardManager ?: return empty
      val clip = clipboard.primaryClip ?: return empty
      if (clip.itemCount == 0) return empty
      val item = clip.getItemAt(0)
      return arrayOf(item.uri?.toString(), item.coerceToText(this@MainActivity)?.toString())
    }

    @JavascriptInterface
    fun installApk(path: String): String {
      val updates = File(cacheDir, "updates").canonicalFile
      val apk = File(path).canonicalFile
      if (apk.parentFile != updates || !apk.name.endsWith(".apk") || !apk.isFile) return "not an update"
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !packageManager.canRequestPackageInstalls()) {
        runOnUiThread {
          startActivity(
            Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName"))
              .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
          )
        }
        return "permission"
      }
      return try {
        // The provider and its `cache-path` entry come from Tauri's template
        // (res/xml/file_paths.xml), which already covers cacheDir.
        val uri = FileProvider.getUriForFile(this@MainActivity, "$packageName.fileprovider", apk)
        val intent = Intent(Intent.ACTION_VIEW)
          .setDataAndType(uri, "application/vnd.android.package-archive")
          .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        runOnUiThread { startActivity(intent) }
        "started"
      } catch (error: Exception) {
        Log.w(TAG, "installApk failed", error)
        error.javaClass.simpleName
      }
    }
  }
}
