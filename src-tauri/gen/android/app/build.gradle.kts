import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

/*
 * RELEASE SIGNING, from a file outside the repo: ~/.config/glyph/android-signing.properties
 * (or $GLYPH_ANDROID_SIGNING). Android installs an update only over an app signed
 * by the same certificate, so this key is the one every install is bound to -
 * it is the copied debug keystore every Glyph APK has been signed with, kept
 * where Android Studio cannot silently regenerate it. deploy-ota.mjs pins its
 * fingerprint (src-tauri/apk-signer.sha256). Without the file a release build
 * comes out unsigned and uninstallable, which is the right failure.
 */
val releaseSigning = Properties().apply {
    val path = System.getenv("GLYPH_ANDROID_SIGNING")
        ?: "${System.getProperty("user.home")}/.config/glyph/android-signing.properties"
    val propFile = File(path)
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

/*
 * GLYPH_STAGING=1 in the build's environment makes a STAGING app: the same
 * code under its own id, installed beside the real Glyph with its own data,
 * so a build can be walked through as a new person would see it (empty
 * notes, no models, the guide) without touching the phone's real notes. It
 * is named "Glyph Staging", its launcher shortcut points at itself, and it
 * never checks attack.fm for updates (ota.rs, the same switch), so what was
 * installed is what runs. GLYPH_CHANNEL=dev is the third app, "Glyph Dev",
 * for `tauri android dev`: the page comes live from the Mac's dev server and
 * reloads as the code changes. The switch is read at configuration time, so
 * two channels must not share a Gradle daemon's config cache; `tauri android
 * build` starts a fresh one each time.
 */
val staging = !System.getenv("GLYPH_STAGING").isNullOrEmpty()
val channel = System.getenv("GLYPH_CHANNEL")?.takeIf { it == "dev" || it == "staging" } ?: if (staging) "staging" else "production"

android {
    compileSdk = 36
    namespace = "com.mattssoftware.glyph"
    sourceSets.getByName("main") {
        // What differs by channel - the launcher shortcut's target package - lives in its own res tree.
        res.srcDirs("src/main/res", "src/channel/$channel/res")
    }
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        manifestPlaceholders["appLabel"] = when (channel) { "dev" -> "Glyph Dev"; "staging" -> "Glyph Staging"; else -> "@string/app_name" }
        applicationId = when (channel) { "dev" -> "com.mattssoftware.glyph.dev"; "staging" -> "com.mattssoftware.glyph.staging"; else -> "com.mattssoftware.glyph" }
        minSdk = 24
        targetSdk = 36
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    signingConfigs {
        if (releaseSigning.getProperty("storeFile") != null) {
            create("release") {
                storeFile = File(releaseSigning.getProperty("storeFile"))
                storePassword = releaseSigning.getProperty("storePassword")
                keyAlias = releaseSigning.getProperty("keyAlias")
                keyPassword = releaseSigning.getProperty("keyPassword")
            }
        }
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            signingConfigs.findByName("release")?.let { signingConfig = it }
            /*
             * No R8. The public release exists to be NOT debuggable (a debuggable
             * app lets anyone with adb copy its notes out), not to be small: the
             * Rust library is 34 MB of the 44 and R8 cannot touch it. What R8 can
             * do is rename or strip the Kotlin that is reached by name - the
             * GlyphHost JavascriptInterface, the capture services the system binds,
             * the JNI entry points - and a release that breaks the side key only
             * on the build people install is the worst place to learn that.
             */
            isMinifyEnabled = false
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
        }
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
    buildFeatures {
        buildConfig = true
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    // Update alerts' periodic background check (updates/UpdateCheckWorker.kt).
    // 2.9.1, not 2.10: the Kotlin plugin here is 1.9.25, and 2.9.1's metadata is
    // one this compiler reads. A plain Worker, so no coroutines artifact either.
    implementation("androidx.work:work-runtime:2.9.1")
    // Reads a picked picture's EXIF orientation, so it goes into the note the right way up.
    implementation("androidx.exifinterface:exifinterface:1.3.7")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = "tauri.build.gradle.kts")