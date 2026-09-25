package com.mattssoftware.glyph.updates

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.work.Worker
import androidx.work.WorkerParameters
import com.mattssoftware.glyph.MainActivity
import org.json.JSONObject
import java.io.File

/**
 * One background look at what is published, and at most one notification.
 *
 * Notifies when the published web build is newer than both what this install
 * already has (`ota/installed.json`, kept by the app) and the last build it
 * notified about - so one release alerts once, never every six hours. A
 * published APK newer than this binary takes precedence, because that update
 * needs the person to act rather than just open the app.
 *
 * Failure is quiet: `Result.success()` either way, so a bad connection does not
 * make WorkManager retry with backoff in between the periodic runs.
 */
class UpdateCheckWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
  override fun doWork(): Result {
    val context = applicationContext
    // The staging and dev apps (build.gradle.kts GLYPH_STAGING, GLYPH_CHANNEL) never update, so they never ask.
    if (context.packageName.endsWith(".staging") || context.packageName.endsWith(".dev")) return Result.success()
    if (!UpdateAlerts.isEnabled(context) || !UpdateAlerts.canNotify(context)) return Result.success()

    val otaDir = File(context.dataDir, "ota").absolutePath
    val answer = try {
      JSONObject(UpdateCheck.run(otaDir) ?: return Result.success())
    } catch (error: Throwable) {
      Log.w(TAG, "update check failed", error)
      return Result.success()
    }
    if (answer.has("error")) {
      Log.i(TAG, "update check: ${answer.optString("error")}")
      return Result.success()
    }

    val prefs = UpdateAlerts.prefs(context)
    val installedCode = installedVersionCode(context)
    val apkCode = answer.optLong("apkVersionCode", 0)
    val lastApk = prefs.getLong(UpdateAlerts.KEY_LAST_APK, 0)
    if (apkCode > installedCode && apkCode > lastApk) {
      val version = answer.optString("apkVersion", "")
      notify(context, "Glyph $version is ready to install", "Open Glyph to install the new version.", 2)
      prefs.edit().putLong(UpdateAlerts.KEY_LAST_APK, apkCode).apply()
      return Result.success()
    }

    val web = answer.optString("webBuild", "").toLongOrNull() ?: return Result.success()
    val installed = answer.optString("installedBuild", "").toLongOrNull() ?: 0L
    val lastBuild = prefs.getString(UpdateAlerts.KEY_LAST_BUILD, null)?.toLongOrNull() ?: 0L
    if (web > installed && web > lastBuild) {
      val version = answer.optString("webVersion", "")
      val notes = answer.optString("notes", "").trim().ifEmpty { "It arrives the next time you open Glyph." }
      notify(context, "Glyph $version is out", notes, 1)
      prefs.edit().putString(UpdateAlerts.KEY_LAST_BUILD, web.toString()).apply()
    }
    return Result.success()
  }

  private fun installedVersionCode(context: Context): Long {
    val info = context.packageManager.getPackageInfo(context.packageName, 0)
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.longVersionCode else {
      @Suppress("DEPRECATION")
      info.versionCode.toLong()
    }
  }

  private fun notify(context: Context, title: String, text: String, id: Int) {
    UpdateAlerts.ensureChannel(context)
    // A plain launch, nothing that reads as ACTION_CAPTURE: tapping an update
    // alert opens Glyph, where the update is applied or offered.
    val open = Intent(context, MainActivity::class.java)
      .setAction(Intent.ACTION_MAIN)
      .addCategory(Intent.CATEGORY_LAUNCHER)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    val pending = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    val notification = NotificationCompat.Builder(context, UpdateAlerts.CHANNEL_ID)
      .setSmallIcon(android.R.drawable.stat_sys_download_done)
      .setContentTitle(title)
      .setContentText(text)
      .setStyle(NotificationCompat.BigTextStyle().bigText(text))
      .setContentIntent(pending)
      .setAutoCancel(true)
      .build()
    try {
      NotificationManagerCompat.from(context).notify(TAG, id, notification)
    } catch (error: SecurityException) {
      Log.w(TAG, "notification refused", error)
    }
  }

  companion object {
    private const val TAG = "GlyphUpdates"
  }
}
