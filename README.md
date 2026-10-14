# Ghost.md

A mobile-first markdown notes app built on [Glacier UI](https://github.com/InfamousVague/GlacierUI):
live formatting that keeps the markdown tokens on screen, haptics as styles land,
and a hardware-button voice capture transcribed on the device.

## Develop

```sh
npm install
npm run dev          # web app on http://localhost:5250
npm run tauri:dev    # desktop window sized like a phone
npm run ios:dev      # iOS simulator (needs Xcode + the Rust iOS targets)
npm run android:dev  # Android emulator (needs the SDK/NDK paths in package.json)
```

The kit is vendored under `vendor/@glacier/*`, so the app installs and runs with
nothing published to npm. Design notes live in `docs/DESIGN.md`.

## Over the air

The phone does not need a cable. `deploy:ota` publishes to
[attack.fm/glyph](https://attack.fm/glyph/), the Caddy document root the marketing site and
DeadCatBounce share on that box.

```sh
npm run deploy:ota            # web build + over-the-air update for installed apps
npm run deploy:ota -- --apk   # also build and publish the release APK (bump the version first)
```

On the phone, open [attack.fm/glyph/install.html](https://attack.fm/glyph/install.html) once
and install the APK. After that the app keeps itself current:

- **Web-layer changes** (almost all of them) ship with a plain `deploy:ota`. The installed app
  looks for `ota.json` a few seconds after launch and whenever it returns to the screen,
  downloads only the files that changed, verifies each SHA-256, and runs the new build on its
  next start (the list also offers "Reload"). A build that fails to start is quarantined and
  the app falls back to the frontend inside the APK in the same launch.
- **Native changes** (Rust, Kotlin, the manifest) need `--apk` and a version bump in
  `tauri.conf.json`. Installed apps see the newer `apk.json`, download it, and hand it to
  Android's installer; the first time, Android asks to allow installs from Ghost.md.
- If a page change starts calling a new Rust command, bump `NATIVE_GENERATION` and
  `BUNDLE_REQUIRES` in `src-tauri/src/ota.rs` and ship with `--apk`: older apps then keep their
  current frontend and offer the APK instead of running a page they cannot support.

Every `ota.json` and `apk.json` is **Ed25519-signed**, and the app accepts only what a key in
`src-tauri/ota-trusted-keys.txt` signed. Trust is a key, not a domain: any host can serve
updates, a redirect cannot inject one, and a domain that lapses and changes hands cannot ship code
into installed apps. The private key is `~/.config/glyph/ota-signing-key.pem` - **back it up**.
Without it no installed app accepts another update, and the only way forward is a new APK
installed by hand.

How it works, and the failure modes it is built around, is the header of `src-tauri/src/ota.rs`
and DESIGN section 14. To test against a local server instead of attack.fm, build with
`GLYPH_OTA_BASE=http://10.0.2.2:8787` (the emulator's view of the host) and serve a `dist/` there.

## Update alerts

Off by default. Settings → Update alerts turns on a notification when a new Ghost.md is published,
even with the app closed: a WorkManager job (`updates/UpdateCheckWorker.kt`) looks every ~6 hours,
and once right away when switched on, calling into Rust over JNI (`src-tauri/src/update_alerts.rs`
→ `ota::peek`) so it trusts only signed manifests and follows a domain move. One release alerts
once. Pass the alert text with `npm run deploy:ota -- --notes "What changed."`. On a Samsung with
"Sleeping apps" battery limits, set Ghost.md's battery use to Unrestricted or the job may never run.

## Signing keys

Two keys decide whether an installed Ghost.md accepts anything from you. Both live outside the repo
in `~/.config/glyph/`, and **both must be backed up off this Mac** (a password manager takes
them as file attachments):

| File | What it signs | If it is lost |
| --- | --- | --- |
| `glyph-android.keystore` (+ `android-signing.properties`) | The APK. Android installs an update only over an app signed by the same certificate, pinned in `src-tauri/apk-signer.sha256`. | No existing install can ever be updated; everyone reinstalls, losing notes on the phone. |
| `ota-signing-key.pem` | `ota.json` / `apk.json` over the air. Public half in `src-tauri/ota-trusted-keys.txt`. | Installed apps stop taking updates until a new APK is installed by hand. |

The APK key is the original Android debug keystore from this Mac, kept because every install
already carries it. It is copied out of `~/.android/` because Android Studio silently makes a new
one whenever that file is missing, and `deploy:ota --apk` refuses to publish an APK signed by
anything but the pinned certificate, or one that is debuggable.

## Moving to another domain

Installed apps look for updates in the order of the newest **signed** `sources` list they have
seen, then the list their APK was built with (`src-tauri/ota-sources.txt`). So moving is a
publish, not a new APK:

1. Serve the same `glyph/` tree from the new host (the files are identical; only where they live
   changes).
2. Put the new base URL **first** in `src-tauri/ota-sources.txt`, keeping attack.fm after it. If
   the formatting endpoint or the model files move too, write `src-tauri/ota-services.json`:
   `{ "format": "https://…/api/format", "modelMirrors": ["https://…/models"] }`.
3. `npm run deploy:ota`. Every 0.3.0+ app that checks in remembers the new list and uses it from
   then on. Ship an `--apk` release as well so fresh installs compile the new list in.
4. Keep attack.fm/glyph serving - or `301` it to the new host - for as long as you can. An app that
   never checks in before the old domain goes dark only knows what its APK compiled in, and 0.2.0
   (which predates signing) only follows redirects.
5. Point `REMOTE` and `URL_` in `scripts/deploy-ota.mjs` at the new box.

An older signed manifest can never roll the list back, and every URL in it must be https.

**Rotating the signing key:** `node scripts/ota-keygen.mjs --new-key-path <path>` adds the new
public key to the trusted list; ship an `--apk` release so installs trust both; then deploy with
`GLYPH_OTA_KEY=<path>`. Drop the old key from the list in a later APK.

A browser tab at attack.fm/glyph is the same app without a Rust core: **no haptics**, and notes
live in that browser's `localStorage` rather than the app's SQLite.

Credentials come from a gitignored `.env` (`AFM_DEPLOY_HOST` / `AFM_DEPLOY_USER` /
`AFM_DEPLOY_PASS`). Note the box moved: the current host is the one AttackFM's `.env`
calls `AFM_NEW_DEPLOY_HOST`.
