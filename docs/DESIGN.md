# Glyph

A mobile-first markdown notes app built on Glacier UI. Three things make it Glyph rather than
another notes app: the markdown renders as you type **without the syntax ever disappearing**, the
phone answers under your thumb as each style lands, and a long-press of the side key captures a
spoken note that is transcribed on the device, with the app closed.

This document is the implementation contract. It was written from the research notes in
`docs/research/` (read those for the evidence behind every claim here; they cite AOSP source,
package sources, and measurements taken on this Mac on 2026-09-11).

---

## 1. Goals and non-goals

**Goals, in the order they break ties**

1. **Typing feels native.** Input latency on a phone is the product. A note of 50,000 words must
   type as smoothly as an empty one.
2. **Tokens stay on screen.** `**bold**` renders bold *with the asterisks still there*, dimmed. A
   heading is bigger *and* still shows its `#`. Nothing is ever hidden, replaced, or folded, so the
   document you edit is exactly the document you see. This is the iA Writer / Bear 1 school, not
   the Obsidian live-preview school, and it is deliberately the simpler of the two.
3. **The phone answers.** A tick when an inline mark closes, a weightier tap when a heading is
   born, a success note on save. Rate-limited so a fast typist never gets mush.
4. **Voice capture from a hardware button**, working with the app closed and with no network.
5. **A simple UI.** A list, an editor, a settings sheet. Glacier components and tokens only.

**Non-goals for v1**

Sync, sharing, attachments, tags, folders, backlinks, search across notes, a preview mode, tables
UI, collaborative editing, a desktop-first layout. The desktop build exists only so the app can be
developed and tested in a window; it is not a product yet.

---

## 2. Stack

Already standing in this repo and verified to build (`npm run build`, `cargo check`, an iOS
simulator bundle, and an arm64 Android APK all pass as of 2026-09-11):

| Layer | Choice |
| --- | --- |
| UI kit | Glacier, vendored at `vendor/@glacier/{react,tokens,icons}` via `file:` deps |
| Frontend | Vite 7, React 19, TypeScript 5.9, CSS Modules over `--glacier-*` tokens |
| Shell | Tauri v2, `com.mattssoftware.glyph`, iOS 15+ and Android (minSdk 24, target 36) |
| Editor engine | CodeMirror 6 |
| Store | Rust: SQLite via `rusqlite` (bundled), WAL |
| Haptics | `@tauri-apps/plugin-haptics` behind Glacier's `HapticsProvider` |
| Transcription | `whisper-rs` (whisper.cpp) on device; cloud opt-in |

Two inherited fixes are already carried from AttackFM and must not be dropped: the vendored
`tao` 0.35.3 with the `autorelease_ptr` backport (without it release iOS builds segfault at launch
on iOS 26/27), and `ensure_key_window` in `src-tauri/src/lib.rs` (without it the iOS keyboard never
rises, which for a notes app is the whole app not working).

---

## 3. The editor core

### 3.1 Why CodeMirror 6

The requirement "the tokens stay visible" decides this on its own. CodeMirror's document **is** the
markdown string; decorations style ranges of that string without changing it. Every rich-text
engine works the other way round: Lexical's `registerMarkdownShortcuts` explicitly clears the
opening and closing tags, and Tiptap's input rules turn `**x**` into a bold mark with the asterisks
consumed. Keeping tokens on those engines means fighting the model in every keystroke.

The others fail on other grounds too. Monaco's own FAQ answers "Is the editor supported in mobile
browsers or mobile web app frameworks?" with "No", and it weighs 1,153 kB gzipped before workers.
A transparent-textarea overlay (what Glacier's own `RichTextEditor` does) only stays aligned
because it is monospace at one size: proportional prose with bold runs and larger headings
desynchronises the caret from the glyphs, so requirement 2 kills it outright. That is not a
criticism of the kit's editor, which is a chat composer and right for that job.

Measured cost of CodeMirror, gzipped: 65 kB for state+view, 174.5 kB for the whole markdown stack.
About 55–60 kB of that is the `lang-html` chain that `@codemirror/lang-markdown` hard-depends on.
**Decision: accept it for v1.** AttackFM's shipped bundle is ~8.8 MB; 175 kB is not the constraint,
parse and layout are, and the chain buys correct highlighting for HTML inside a note. Revisit only
if a cold-start measurement on the Fold says otherwise.

Performance, measured on a 380 kB / 55,817-word note: full parse 27–32 ms, reparse after an
edit 1.1 ms. The view renders only the viewport; the parser works in idle slices and yields when
`navigator.scheduling.isInputPending()` says a keystroke is waiting.

### 3.2 How tokens stay visible

Two layers, and between them they are the entire renderer. There is no widget machinery, no
replacement decorations, no reveal-on-cursor logic — all of which exist in Obsidian-style
implementations *because* they hide the markers. Glyph never hides them, so it needs none of it.

**Inline — one `HighlightStyle`, no plugin code.** Lezer's markdown grammar already tags every
marker (`#`, `**`, `>`, `` ` ``, `-`, `[`, `]`) as `processingInstruction`, and emits one span per
run carrying the union of its tags. So `**` gets `strong` *and* `processingInstruction` while the
word between gets only `strong`. One rule styles the content, one rule dims every marker:

```ts
export const glyphHighlight = HighlightStyle.define([
  { tag: tags.heading1, class: styles.h1 },
  // ...heading2..6, strong, emphasis, strikethrough, monospace, link, url, quote, list...
  { tag: tags.processingInstruction, class: styles.mark }, // MUST be last: same specificity wins by order
]);
```

`.mark` sets `color: var(--glacier-text-subtle)` and `font-weight: var(--glacier-font-weight-regular)`
and nothing else. It must never change size, because a marker that changes the line's metrics as it
is typed makes the text jump under the thumb. Never `opacity` (it dims the background through the
glass) and never `--glacier-text-disabled` (it fails AA contrast).

**Block — one small `ViewPlugin` with `Decoration.line`.** Padding above a heading, the quote bar,
the list hanging indent, and the fenced-code background need the line element, which an inline span
cannot reach. The plugin walks `syntaxTree` over `view.visibleRanges` only, maps a node name to a
line class, and builds a `RangeSetBuilder` of zero-length line decorations. See
`docs/research/codemirror.md` §6b for the exact code, including the two rules that bite: line
decoration ranges must be zero-length and sit at `line.from`, and `RangeSetBuilder.add` must be
called in sorted order.

Under an active IME composition the plugin maps its existing decoration set through the changes
instead of rebuilding (`this.decorations.map(u.changes)`). Decoration churn mid-composition is the
classic mobile bug class — four separate CodeMirror issues, all Android or iOS.

### 3.3 Type scale

Body is `--glacier-font-size-md` in `--glacier-font-sans`. Headings step **one below the kit's
heading map**, because the kit's H1 is `3xl`, which is 44 px on a phone and turns a note into a
poster:

| | H1 | H2 | H3 | H4 | H5 | H6 |
| --- | --- | --- | --- | --- | --- | --- |
| size | `2xl` | `xl` | `lg` | `md` | `md` | `sm` |
| weight | bold | semibold | semibold | semibold | semibold | semibold |

Each takes its matching `--glacier-leading-*` and `--glacier-tracking-*` step. H6 also takes
`--glacier-text-subtle`; it does **not** take the kit's `text-transform: uppercase`, because typed
characters have to read as typed. Variable line heights are supported — the view keeps a height
map, estimated first and measured when drawn.

Full token assignments for every element (inline code, fenced code, quote bar, list markers, links,
selection, caret, placeholder) are tabulated in `docs/research/tokens.md` §7, and the list of
plausible-sounding tokens that **do not exist** is in §8. Do not invent one; there is no
`--glacier-caret`, no `--glacier-link`, no `--glacier-code-bg`.

### 3.4 Theming

`EditorView.theme(spec, {dark})` scopes its rules under a generated class, and style-mod writes
values verbatim — so `var(--glacier-surface)` passes straight through and Glacier's `data-theme`
flip on `<html>` retunes the editor with no rebuild. The `dark` flag still goes through a
`Compartment` and is reconfigured on theme change, so CodeMirror's own `&dark` base rules agree
with the rest of the app.

### 3.5 Mobile input

CodeMirror defaults `.cm-content` to `spellcheck: false`, `autocorrect: off`,
`autocapitalize: off`, `writingsuggestions: false` — correct for code, wrong for prose. Glyph
overrides all four through `EditorView.contentAttributes`:

```ts
{ autocorrect: 'on', autocapitalize: 'sentences', spellcheck: 'true', inputmode: 'text', enterkeyhint: 'enter' }
```

with a Settings switch to turn them off, because autocorrect and markdown syntax do occasionally
argue.

**Do not install `drawSelection()`.** It hides the native caret, which on Mobile Safari also hides
the native grab handles, the magnifier, and the callout — and it costs an extra DOM layout cycle
per update. Keeping the native selection gives all of that back for free; the colour comes from
`caret-color` and `::selection` in the theme. (CodeMirror ships
`drawSelection({iosSelectionHandles: true})` to redraw what it broke; the better move is not to
break it.)

`markdown()` is configured `{ base: markdownLanguage, addKeymap: true, completeHTMLTags: false,
pasteURLAsLink: true }`. `base: markdownLanguage` is GFM (the default `commonmarkLanguage` has no
`~~` and no task lists). `addKeymap` gives Enter → `insertNewlineContinueMarkup`, which continues a
list for you and is the single most useful phone behaviour in the package.
`completeHTMLTags: false` stops a `<` from raising an autocomplete popup over a phone keyboard.

**Budgets.** Keystroke to paint under 16 ms on the Fold at 5,000 words; note open to first paint
under 150 ms; no frame over 50 ms while scrolling a 50,000-word note. Measured with
`performance.now()` around the update listener and a Chrome DevTools trace over the Android
WebView, not by feel.

---

## 4. Haptics

The kit's web haptics never reach WKWebView; the motor is the Tauri plugin. Glyph mounts
`<HapticsProvider enabled={false} impl={hapticsImpl}>` exactly as AttackFM does — `enabled={false}`
switches off the kit's delegated `pointerdown` tick, which fires at the start of a scroll flick and
buzzes all the way down a list — and installs its own tap tick on `pointerup` with a 10 px slop and
a 700 ms ceiling.

`src/app/ux/ratchet.ts` and the 28 ms floor in `fireFelt` are ported from AttackFM unchanged. The
Taptic Engine queues a flood and plays it back as mush; a floor is what keeps a fast typist from
feeling porridge.

| Event | Kind | How it is detected | Limit |
| --- | --- | --- | --- |
| Inline mark closed (`**`, `_`, `` ` ``, `~~`, `]`) | `selection` | Transaction inserted a closing character; the enclosing `StrongEmphasis`/`Emphasis`/`InlineCode`/`Strikethrough`/`Link` node exists in the new tree at the caret and did not in the old one | 28 ms floor |
| Heading created | `medium` | A new `ATXHeading1-6` line node where the old tree had none | 28 ms floor |
| Quote, list, rule, fence created | `light` | Same test against `Blockquote`, `ListItem`, `HorizontalRule`, `FencedCode` | 28 ms floor |
| List continued on Enter | micro tick (`impactFeedback('soft')`) | `insertNewlineContinueMarkup` inserted a marker | 28 ms floor |
| Task box toggled | `selection` | Tap handler on `TaskMarker` | per tap |
| Formatting bar press | `selection` | The bar's own transaction, annotated `input.format` | per tap |
| Note saved | `success` | Store write resolved | once per save |
| Capture started / stopped | `medium` / `success` | Capture state machine | once each |
| Ordinary characters | nothing | — | — |

The detection is a tree diff, not a regex, because a regex fires inside fenced code where no mark
was created. Transactions carrying `input.type.compose` are skipped entirely: mid-composition an
IME rewrites the same characters repeatedly, and every rewrite would buzz. The exact code is in
`docs/research/codemirror.md` §11.

---

## 5. The notes store

**The store is Rust-owned, and that is forced by the capture feature.** On Android the capture
overlay runs in a separate process with no webview alive; it must be able to write a note. So the
store cannot live in the page.

SQLite through `rusqlite` (bundled, so no system library), at `<app_data_dir>/glyph.sqlite` in WAL
mode with `busy_timeout` set, because two processes write it.

```sql
notes(id TEXT PRIMARY KEY, body TEXT NOT NULL, created_at INTEGER, updated_at INTEGER, source TEXT)
captures(id TEXT PRIMARY KEY, note_id TEXT, audio_path TEXT, model TEXT, duration_ms INTEGER, state TEXT)
```

The Rust module (`src-tauri/src/store.rs`) takes no `tauri::` types. That is the load-bearing
constraint: the same functions are called by the Tauri commands *and* by a JNI entry point from the
Android capture service, and the capture process never runs `tauri::Builder`. Commands exposed to
the page: `list_notes`, `get_note`, `save_note`, `delete_note`, `pending_captures`.

The page reaches it through one module, `src/app/core/store.ts`, which falls back to a
`localStorage` implementation of the same interface when `isTauri()` is false — so `npm run dev` in
a browser is a real working app, which is where most of the editor work will actually happen.

Saving is debounced 400 ms after the last keystroke and flushed on blur, on route change, and on
`visibilitychange`. A phone kills backgrounded webviews without warning; an unflushed draft is lost
work and lost trust.

---

## 6. Voice capture

### 6.1 Android: yes, and here is exactly how

The answer to "can I press and hold a hardware button to dictate a note": **yes**, by Glyph
becoming the device's digital assistant. That single role covers every trigger worth having — Pixel
long-press power, Samsung side key press-and-hold, corner-swipe, and home-button long-press all
route to the assistant role holder. Verified against AOSP `main`: `PhoneWindowManager.powerLongPress()`
case `LONG_PRESS_POWER_ASSISTANT` performs its own haptic and calls `launchAssistAction(...)`.

Two things to know before building it:

- **The role cannot be requested from code.** `roles.xml` marks `ASSISTANT` as
  `requestable="false"`, so `createRequestRoleIntent` shows nothing. Onboarding must open
  `Settings.ACTION_VOICE_INPUT_SETTINGS` and ask the user to pick Glyph, and read the result back
  with `RoleManager.isRoleHeld`.
- **It is exclusive.** Holding it means giving up Gemini or Bixby on that phone. That is a real
  cost and the onboarding must say so plainly, and must offer the Quick Settings tile and the
  `glyph://capture` shortcut to anyone who says no.

Volume-key long-press in the background is **not** feasible without an `AccessibilityService`,
which Play restricts. Dropped.

The shape, in `src-tauri/gen/android/app/src/main/java/com/mattssoftware/glyph/capture/`, hand
written and tracked in git the way AttackFM tracks its Kotlin (a plugin crate buys nothing here and
costs a build):

1. `GlyphInteractionService` — the `VoiceInteractionService`. The system keeps it bound and alive.
2. `GlyphSession` / `GlyphSessionService` — the overlay. Its window is `TYPE_VOICE_INTERACTION`,
   window layer 21, which AOSP comments as "above the lock screen", so capture works on a locked
   phone. `onShow` starts `AudioRecord` at 16 kHz mono PCM16 and reads `invocation_type` from the
   args so the note can record that it came from the side key.
3. `GlyphRecognitionService` — a stub that returns `ERROR_RECOGNIZER_BUSY`. It exists only because
   the role check refuses a service whose metadata lacks `recognitionService`.

Stop (or a 90 s cap) writes a WAV to `<filesDir>/captures/`, starts a `shortService` foreground
service whose notification doubles as the progress indicator, and calls into Rust over JNI. The
generated `Rust.kt` already does `System.loadLibrary("app_lib")`, and `crate-type` already includes
`cdylib`, so a `#[no_mangle] extern "system"` function is reachable from the capture process with
no Tauri involvement. When the app is next resumed, `MainActivity.onResume` evaluates
`window.__glyph?.refresh()` and the page re-queries the store — no cross-process events needed.

### 6.2 Transcription

`whisper-rs` 0.16, model `ggml-base.en-q5_1.bin` (60 MB), downloaded on first run with a SHA-256
check, with `tiny.en-q5_1` (32 MB) bundled as the offline floor and the automatic choice on a
low-RAM device. Planning figures: base.en-q5_1 transcribes a 60 s note in roughly 10–20 s on a
2023+ flagship, tiny.en in 4–8 s. Large models OOM on phones; do not offer them.

**The build risk is the cross-compile, not the code.** `tauri android build` sets no
`CMAKE_TOOLCHAIN_FILE`, so ggml must be pointed at the NDK toolchain by hand through
`src-tauri/.cargo/config.toml`, bindgen needs the NDK sysroot, and the resulting `.so` will need
`libc++_shared.so` copied into `jniLibs`. This is milestone 1 for a reason: it is the only part of
the plan that might not work, and everything else is useful whether or not it does. Fallbacks, in
order: the `sherpa-onnx` crate, Android's on-device `SpeechRecognizer`, the OpenAI API as an opt-in
setting (~$0.006/min).

### 6.3 iOS

**iOS cannot record from the background at all** — Apple's own forum answer is that an app cannot
initiate an `AVAudioSession` recording from the background via an intent. So the iOS story is
foreground-first and honest about it: an App Shortcut (`CaptureNoteIntent`, reachable from the
Action button on iPhone 15 Pro and every 16/17, from Back Tap on anything since the 8, and from
Siri and Spotlight) foregrounds Glyph and starts recording on arrival. The target is under a second
from press to recording, which means starting `AVAudioEngine` in Swift before the webview paints.

On iOS the transcription default should probably be Apple's own `SpeechTranscriber` (iOS 26) rather
than whisper: it is free, on-device, and better. whisper-rs with the `metal` feature is the pre-26
path. That keeps whisper's build risk on one platform instead of two.

---

## 7. UI v1

Three screens, hand-composed rather than using the kit's `AppShell`, because `AppShell`, `Drawer`
and the toast viewport have no `env(safe-area-inset-*)` handling and no className hook to add it —
on a notched phone their content sits under the notch. Everything *inside* the layout is Glacier.

**Notes list.** A header (title, a settings `IconButton`, a new-note `IconButton`), then a scrolling
list of two-line rows: first line of the note as the title in `Text weight="medium"`, second line a
`--glacier-text-muted` preview, with a relative timestamp. A row is a `Card variant="wash"
interactive`. Swipe-to-delete is v1.1; long-press opens a `Menu` with Delete, which routes through
an `AlertDialog tone="danger"`. The floating capture button sits bottom-right above the safe area.

**Editor.** Full-bleed CodeMirror under a slim header carrying back, a title that is just the first
line, and an overflow `Menu`. A formatting bar docks above the keyboard — bold, italic, code,
heading, quote, bullet, link — implemented as CodeMirror transactions annotated
`input.format`, using the same delimiters the kit uses (`**`, `_`, `` ` ``, `~~`) so what the bar
writes is what the highlighter reads. Keyboard avoidance rides `visualViewport`, which is the only
thing that reports the real keyboard inset in a WebView.

**Settings.** A bottom `Drawer` with theme, accent, density, font, haptics on/off, autocorrect
on/off, transcription model, and the capture-role onboarding card. Preferences persist to
`localStorage` and stamp `data-*` attributes on `<html>` exactly as AttackFM's `appearance.tsx`
does: an attribute is *removed* when its value is the default, so the token `:root` defaults win.

---

## 8. File layout

```
src/
  main.tsx                    fonts.css -> tokens.css -> @glacier/react/styles.css -> app.css
  app/
    App.tsx                   route switch (list | editor | settings), no router library
    app.css                   phone shell, --app-safe-*, keyboard inset
    core/
      platform.ts             isTauri, isIOS, isAndroid, isMobile
      haptics.ts              fireNativeHaptic, fireFelt, fireMicroTick, hapticsImpl, pref
      store.ts                notes API; Tauri commands, localStorage fallback
      preferences.ts          theme/accent/density/font/haptics/autocorrect + applyPreferences
    ux/
      ratchet.ts              ported from AttackFM, with its test
    editor/
      Editor.tsx              the CodeMirror host component
      Editor.module.css       every token rule from tokens.md §7
      glyphHighlight.ts       the inline HighlightStyle
      glyphLines.ts           the block ViewPlugin
      glyphTheme.ts           EditorView.theme over --glacier-* + the dark Compartment
      feel.ts                 transaction -> haptic
      format.ts               the formatting bar's commands
    notes/
      NotesList.tsx, NoteRow.tsx
    settings/
      SettingsSheet.tsx
src-tauri/src/
  lib.rs                      builder, ensure_key_window, command registration
  store.rs                    SQLite; NO tauri types
  capture.rs                  JNI entry points; whisper
```

---

## 9. Dependencies to add

npm: `@codemirror/state` 6.7.4, `@codemirror/view` 6.43.11, `@codemirror/language` 6.12.4,
`@codemirror/commands` 6.11.0, `@codemirror/lang-markdown` 6.5.2 (pulls `@lezer/*`).

cargo: `rusqlite` (feature `bundled`), `serde`/`serde_json` (already there), later `whisper-rs`
0.16 and `jni`.

---

## 10. Build plan

Each milestone ends with a build pushed to the Fold (`npm run push:fold`) and a specific thing to
check by hand on the phone.

| # | Milestone | Acceptance check on the Fold |
| --- | --- | --- |
| 1 | **whisper-rs Android spike.** Get `whisper-rs` cross-compiling for `aarch64-linux-android` and transcribe one bundled WAV through a temporary Tauri command. Nothing else depends on it, and everything else is wasted if it is impossible. | A test button returns transcribed text, with a timing log |
| 2 | **Store + shell.** SQLite store, Tauri commands, the localStorage fallback, the notes list, create/open/delete. Plain `<textarea>` editor. | Notes survive force-quit; list is correct |
| 3 | **Editor core.** CodeMirror with `glyphHighlight`, `glyphLines`, `glyphTheme`, prose content attributes, native selection. | `**bold**` shows bold with visible dimmed asterisks; headings grow; selection handles and the magnifier work; typing is smooth in a long note |
| 4 | **Haptics.** The bridge, the ratchet, `feel.ts`, the Settings switch. | A tick as `**` closes, a heavier tap on a new heading, nothing while scrolling, no mush when typing fast |
| 5 | **Formatting bar + settings sheet.** Keyboard-docked bar, full appearance settings. | Bar tracks the keyboard exactly; theme and density flip the editor live |
| 6 | **Android capture.** The three Kotlin services, the role onboarding, the overlay, the JNI write, `refresh()` on resume. | Long-press the side key with Glyph closed, speak, and find the note in the list |
| 7 | **iOS capture.** `CaptureNoteIntent`, Action button / Back Tap, `SpeechTranscriber` with whisper fallback. | Back Tap starts recording in under a second |

---

## 11. Risks

1. **whisper-rs will not cross-compile for Android** (cmake toolchain, bindgen sysroot,
   `libc++_shared.so`, periodic ggml aarch64 breakage). *Mitigation:* milestone 1; then
   `sherpa-onnx`, then `SpeechRecognizer`, then cloud.
2. **Users must give up Gemini to give Glyph the side key**, and the role cannot be requested in
   code. *Mitigation:* honest onboarding; tile and shortcut paths for those who decline.
3. **CJK IME on iOS** is the live CodeMirror bug area (issue 1748, Korean input, 2026-09).
   *Mitigation:* skip decoration rebuilds while `view.composing`; add a Korean/Japanese keyboard
   pass to device testing.
4. **Two processes writing SQLite.** *Mitigation:* WAL, `busy_timeout`, short transactions,
   `refresh()` on resume.
5. **Play review of `FOREGROUND_SERVICE_MICROPHONE`** needs a declaration and a demo video.
   *Mitigation:* record only while the overlay is up unless the user backgrounds mid-capture;
   prominent disclosure before the `RECORD_AUDIO` prompt.
6. **Lock-screen behaviour differs by OEM.** *Mitigation:* test Pixel and Galaxy;
   `supportsLaunchVoiceAssistFromKeyguard="true"`; never rely on an `ACTION_ASSIST` activity for
   locked capture.
7. **The manifest is regenerated.** The deep-link plugin rewrites its own region on every build.
   *Mitigation:* keep the capture entries outside it, tracked in git, and commented.

---

## 12. Open questions for Matt

None of these block milestones 1–4; each has a default already chosen so work does not stop.

1. **Editor face.** Sans at `md` (chosen — the iA/Bear feel) or the kit's mono at `sm`?
2. **Heading sizes.** One step below the kit map (chosen) or the kit map, with a 44 px H1?
3. **Caret colour.** Accent (chosen — matches the platform tint) or `--glacier-text` (kit precedent)?
4. **Backspace after `- `.** `addKeymap: true` gives `deleteMarkupBackward`, which removes the
   whole list marker in one press. Useful, but invisible to a phone user until it happens. Keep it
   (chosen) or bind plain Backspace?
5. **Is giving up Gemini acceptable to you personally** on the Fold, or should the tile and
   shortcut be the primary path with the assistant role as an opt-in?

---

## 13. Capture, as built (2026-09-12)

Matt chose **press-and-hold of the side key**, replacing Gemini as the digital assistant.
Three decisions changed from sections 6 and 7 above once the device and the server were
inspected, and they are recorded here rather than silently edited in.

**The side key opens the app, not an overlay.** Section 6.1 planned a native overlay drawn
by the voice interaction session. The note has to render as live markdown while it is
spoken, and the only markdown renderer in the app is the CodeMirror editor in the webview,
so a native overlay would have meant a second renderer that drifts from the first. Instead
`GlyphSession.onShow` launches `MainActivity` with `ACTION_CAPTURE` and hides itself. The
activity grants itself `showWhenLocked` for that one capture and withdraws it when the
capture ends; a capture finished on a locked phone steps back behind the lock screen
instead of opening the note. `startActivity`, not `startAssistantActivity`: the latter uses
the assistant activity type, which would put a second `singleTask` Tauri activity, and a
second Rust runtime, in a separate task.

**Audio is captured in the page.** `getUserMedia` into an `AudioWorklet` at 16 kHz, streamed
to Rust as raw `f32` bytes over Tauri IPC. This is the path AttackFM's Booth already proves
on the same phone, and the generated `RustWebChromeClient` already turns the page's request
into Android's microphone prompt. Samples captured before the model has loaded are held and
replayed, so the first words are never lost to warm-up.

> **Removed in 0.6.0.** The server pass below is gone: capture formats with the spoken cues and the
> local rules in `markdown.ts` only, and the page no longer calls `/glyph/api/format`. glyph-api
> still runs on the box, unused. Kept as the record of what was built.

**Formatting is annotation, on attack.fm, by Ollama.** The box runs Ollama with local models
and no GPU, so a model rewriting a whole note would take tens of seconds. The model instead
returns a title, phrases to bold, to-dos, enumerations and section breaks, each an exact
substring of the transcript; the server drops anything that is not verbatim, the phone
checks again, and `src/app/capture/markdown.ts` applies them. The model therefore cannot
change a word Matt said. Local rules format the note while he speaks, and annotations take
over for the text they covered, by offset, so speech after the last request is never left
unformatted while it waits.

| Piece | Where |
| --- | --- |
| Assistant hook | `src-tauri/gen/android/.../capture/*.kt`, `MainActivity.kt`, `AndroidManifest.xml`, `res/xml/glyph_*.xml` |
| Streaming Whisper | `src-tauri/src/whisper/`, `src-tauri/src/capture_commands.rs` |
| Microphone | `src/app/capture/audio.ts` |
| Engine interface | `src/app/capture/engine.ts` (Whisper, browser, simulated) |
| Speech to markdown | `src/app/capture/markdown.ts` |
| Annotation client | `src/app/capture/annotate.ts` |
| Screen | `src/app/capture/CaptureScreen.tsx` |
| Server | `server/`, `scripts/deploy-server.mjs`, `https://attack.fm/glyph/api/format` |
| Model files | `https://attack.fm/glyph/models/` |

Develop the capture screen without a phone at `http://localhost:5250/?capture&simulate`.

The one setting Glyph cannot change for itself: Settings > Apps > Default apps > Digital
assistant app > Glyph. Android marks the assistant role as not requestable by apps.

---

## 14. Typography first, and updates over the air (2026-09-12)

Matt asked for a UI driven by large type with minimal chrome, and for the phone to update
without a cable. Both reverse earlier decisions, recorded here rather than silently edited.

**Type is the interface.** Section 3.3 held headings one step *below* the kit map so a note
would not read as a poster; the poster is now the point. The scale lives in `app.css` as
`--app-*` properties, each a kit step multiplied rather than a new number: the list title is
`5xl × 1.3`, a note's title in the list is `2xl`, editor body is `lg`, and H1–H6 run `4xl`
down to `md`, with leading and tracking tightening as size grows. A Text size setting
(Large / Larger / Largest) scales all of it, and a Typeface setting exposes the kit's three
sans families; Inter's optical-size axis is loaded so display sizes get the display cut.
Section 7's chrome goes: no cards, no header bars, no icon buttons. Actions are words
(Settings, Write, Speak, Notes, Delete, Discard, Save) and the formatting bar's keys are the
markdown characters themselves. The hairline between list rows is the only rule on screen and
the Speak dot the only colour.

**Updates over the air.** An installed Glyph runs either the frontend compiled into the APK or
a newer `dist/` it downloaded from `attack.fm/glyph/ota.json`, served through a custom `ota`
URI scheme. The scheme is the departure from AttackFM, which uses Tauri's `asset:` protocol and
so must inline every chunk and font into two fixed-name files: an `ota` URL keeps real paths,
so the OTA bundle is the ordinary Vite build and unchanged files (the fonts, mostly) are
reused rather than downloaded. The loader in `index.html` never removes a script tag; each copy
of `main.tsx` asks `__glyphBoot` whether it was chosen. A bundle that fails to load, throws
while starting, or does not mount in 8 s is quarantined and the embedded frontend mounts in the
same launch; one staked at launch and never reported mounted twice running is quarantined at
the next. Native changes ship as an APK the app downloads, verifies and hands to Android's
installer. The full contract is the header of `src-tauri/src/ota.rs`.

| Piece | Where |
| --- | --- |
| Type scale, word buttons | `src/app/app.css` |
| Text size, typeface | `src/app/core/preferences.ts`, `src/app/settings/SettingsSheet.tsx` |
| Scheme, boot wager, install, APK download | `src-tauri/src/ota.rs` |
| Loader | `index.html` |
| Mount handshake | `src/main.tsx` |
| Checks, reload, APK install | `src/app/core/ota.ts` |
| APK installer hand-off | `MainActivity.kt` (`GlyphHost.installApk`), `REQUEST_INSTALL_PACKAGES` |
| Manifest | `vite.config.ts` writes `dist/ota.json` |
| Publishing, install page | `scripts/deploy-ota.mjs`, `public/install.html` |
| Signing, keys, sources | `scripts/ota-sign.mjs`, `scripts/ota-keygen.mjs`, `src-tauri/ota-trusted-keys.txt`, `src-tauri/ota-sources.txt` |

**Signed, and not tied to a domain (0.3.0).** Before a public APK, the update path could not depend
on attack.fm staying Matt's: a lapsed domain would have let its next owner ship code into every
install. Manifests are now Ed25519-signed (native generation 2), verified with `ring` before a
parser sees a byte, and carry `sources` and `services` that the app remembers - so installs can
be moved to a new domain by a signed publish, and service endpoints (formatting, model mirrors)
move with them. Verified on the emulator: a tampered manifest is refused and nothing is
remembered; a signed one installs and records its sources; with the first server gone, the app
updates from a second server it learned of only through a signed manifest; and a signed apk.json
from that server offers the APK. README "Moving to another domain" is the procedure.

**0.3.2: swipes, alerts, and a theme to start with.** List rows swipe (`notes/SwipeRow.tsx`): right
to star, left to archive, further left to delete, each threshold a haptic detent that is also
shown (one word behind the row, red for delete) because a fast fling can cross two inside one motor
pulse. Stars and archiving are columns in SQLite (`starred`, `archived_at`, added by an idempotent
migration) and are not edits - they do not move `updated_at`. Delete is deferred behind an Undo
toast rather than done and re-saved, and is made final the moment the app is backgrounded, a
capture starts, or a second delete arrives. Update alerts are opt-in background notifications
(README "Update alerts"); the first-run guide now opens by asking light or dark, applied live.

---

## 15. On-device formatting and project context (2026-09-12) - removed in 0.6.0

> Removed at Matt's call: "summaries and suggestions" are out. Glyph is voice, live transcription,
> and markdown from the spoken cues. Gone with it: the on-device model and its download, the
> Raw | Formatted view, marked suggestions, projects, the project scanner on attack.fm, and the
> server annotation pass (section 13). Native generation 6 marks the removal; on first launch the app
> deletes the 1.28 GB model file if it was ever downloaded. Kept here for what was measured, because
> it is the answer to "why not just add an LLM" the next time it comes up.

What was built and shipped in 0.4.0 to 0.5.x: llama.cpp in the app, running Qwen3.5-2B Q4_K_M
(1.28 GB) on the phone's CPU, with a prefix snapshot so a repeated system prompt was not decoded
twice; a Raw | Formatted switch carrying CriticMarkup `{++ suggestions ++}`; and projects - public
git repositories read on attack.fm into ~1,500-token context packs kept on the phone.

What the measurements said, and still say:

- **Small models rewrite.** Asked to "keep every word, mark additions", all four 1-2B models tried
  (Qwen3.5 2B and 0.8B, LFM2.5 1.2B, Gemma-3 1B) reworded the note - dropped "I need to", invented
  labels, added chatty closers. Asked to quote sentences, they "tidied" the quotes. What worked was
  showing the note as numbered sentences and asking for indices under a GBNF grammar, then
  formatting with code, so the words could not change by construction.
- **Two ggml copies crash.** whisper-rs and llama-cpp-2 each bundle ggml under the same static
  library names; they link without complaint and fail at run time (SIGBUS on Qwen3.5's first
  decode). It took a vendored whisper-rs-sys built against llama's ggml. With llama gone, whisper is
  back on its own bundled ggml, exactly as through 0.3.2.
- **Grammar sampling is slow over a big vocabulary.** Checking the model's first choice against the
  grammar before filtering the whole vocabulary took Qwen3.5-2B from 29 to 44 tokens a second on four
  Apple-silicon cores.

## 16. Ink (2026-09-13)

Matt's direction: minimal, monochrome, and trivially inverted between light and dark. The references were black-and-white
phone screens: pure ink on paper, one black pill per screen, big grotesk type, grey surfaces, a selected row printed in
reverse, and a dot grid as the only texture.

Built at the token layer, in `src/app/ink.css`, imported after everything else:

- **One neutral scale**, `--app-gray-1` (paper) to `--app-gray-12` (ink), chroma zero, defined for paper and reversed for
  dark. Every Glacier semantic token and ramp is mapped onto it, accent and status colours included: danger is ink, and a
  state is said with a word or a shape. Kit components restyle without being touched. The one exception, at Matt's call:
  a swipe's Delete is red (`--glacier-red-9`, the kit ramp `ink.css` leaves unmapped), word and armed band alike.
- **Named tokens for app CSS**: `--app-paper`, `--app-paper-2`, `--app-paper-3`, `--app-rule`, `--app-ink` to
  `--app-ink-4`, `--app-wash` (a translucent ink tint for highlights), `--app-dots` / `--app-dots-size`.
- **`.app-inverse`** re-declares the whole mapping on the reversed scale, so any element - a chosen row, an armed
  swipe - prints in reverse, kit components inside it included. (An armed Archive is ink with paper words; an armed Delete
  is the red exception above.)
- **`.app-pill`** is the one loud button (Speak, Next, Scan); everything else stays an `.app-word`. **`.app-dots`** is the
  texture, used for empty space only: the guide's cover and the empty list.

The accent picker is gone: there is nothing left for it to choose. `preferences.accent` still loads from old storage and
is never applied. Two kit parts no token reaches are handled by structure rather than hashed class names: the segmented
control's selected label turns paper on its ink thumb, and the switch's literal `#fdfdfd` thumb takes the page's paper.

## 17. The tape (2026-09-13)

Matt asked for the press-and-hold capture screen to show a skeuomorphic tape spinning, the way
AttackFM shows its disc: hold it to pause, let go to carry on, and rewind to talk over what was
said, with the words being recorded over highlighted as it winds back.

**A tape in miniature** (`capture/Cassette.tsx`, physics in `capture/tape.ts`). Recording moves
tape from the left reel to the right one at a constant speed, so the right pack grows with the note
(area-conserving radii over a five-minute tape) and each reel turns at tape speed over its own
radius. Only the reels and pack radii are touched per frame, through refs; shell, label and glass are
static layers, as on the disc. The shell and label are printed in the ink tokens, so the tape reverses
with the theme; the wound tape, well and hubs keep literal values.

**The transport is the tape.**

- *Hold* pauses: the page stops handing samples to the engine, so the recording's timeline stands
  still (no silence is sent, so no false paragraph break), and the header counter - time recorded,
  not time passed - stops with it.
- *Turn the reels back* (clockwise, against the recording spin) to wind back: one slow turn of a
  half-full reel is ~2.5 s, spinning fast multiplies it up to ten times. A soft tick every second, a
  firmer one at every phrase start. The note washes out (`--app-wash`) from the first word that will
  not stand - found by rendering the note as it would stand and comparing, so titles and lists need
  no mapping - and scrolls to it. Winding forward gives the words back.
- *Let go* after winding: the phrases after the point are dropped at once and recording continues
  from there, over the top.

**Rewind in the engine** (`whisper/stream.rs`, `worker.rs`, `capture_rewind`, native generation 4).
The streamer now keeps the whole recording (16-bit, ~1.9 MB a minute) and each committed segment's
end sample. `rewind(to_ms)` drops whole segments that end after the point (whisper's word times are
not good enough to cut inside one), truncates the recording, rebuilds the window state at the last
kept segment's end with the VAD re-primed from the ~3 s before it, and re-feeds the audio up to the
point as uncommitted - so the start of the phrase is transcribed again with what is said next, and
new segments tile onto the kept ones. It emits an empty partial and `capture://rewound { toMs,
segments }` carrying every segment that still stands; the page replaces its list rather than counting,
so a segment lost to an aborted tick cannot leave the two sides disagreeing. An inference in flight is
cut short with the abort flag, which the worker clears when it takes the request, under the mailbox
lock; the request carries the audio pushed before it, so audio pushed after lands after the point.

On a generation-3 binary the tape still pauses; turning the reels does nothing. The browser engine
pauses too; the `?simulate` engine rewinds, which is how the screen is exercised without a phone.

## 18. The side key, continued (2026-09-13)

Matt: a held side key should record onto the same note if the last recording was a few minutes ago,
close everything else, and use an even barer recorder; and ideally stop when the key is released, or
at least when it is held again.

- **Continuing.** A side-key capture that starts within five minutes of the last capture ending adds
  to that note (`capture/continuation.ts`; the last capture is remembered in localStorage, since it is
  a fact about this device's last few minutes). The new words go below the note's text with a blank
  line; they take no `# title` of their own (`renderNote(…, { titled: false })`: a spoken "Title: …"
  there becomes a `## heading`). The note's text before the capture is read from the store once, when
  the first draft is written - after an editor that was open has flushed - and Discard puts it back
  exactly. "New note" is one tap away. Over the lock screen the continued note is not named.
- **Clearing the stage.** The side key closes the settings sheet, the walkthrough, an open note and
  the keyboard before the recorder mounts; the capture ends on the note (or the list, when locked).
- **The bare recorder** (`quick`, for captures from outside the app): no header, status or editor.
  A single small line says where the words are going (or what is wrong), the last words said fill the
  screen in display type (`capture/Tail.tsx`, bottom-aligned, fading out at the top, the guessed
  phrase lighter, rewound words washed), then the tape, Discard and Done. Tapping the top line shows
  the pipeline diagnostics, which also appear by themselves when Whisper has heard eight seconds and
  produced nothing.
- **Memo mode (0.5.10, fixed in 0.7.1).** With the setting on, every recording - the Speak button
  as much as the side key - goes onto the last spoken note until New note is tapped. Until 0.7.1 the
  lookup ran only for side-key captures, so a recording from the list made a new note.
- **Stopping.** Holding the side key again during a capture saves it. Letting go cannot: Android
  hands the assistant app the hold (`onLaunchVoiceAssistFromKeyguard` / `ACTION_ASSIST`) and never the
  release - the side key is the power key, and its events are not delivered to apps.
- **Icon.** First the tape zoomed in until the window and reels filled the square; from 0.6.2, at
  Matt's ask, its top-left corner instead (`design/app-icon.svg`): the rounded shell corner with its
  screw, the label's corner with the A mark and the start of the title, and the left reel, on paper.
  The adaptive foreground (`design/app-icon-foreground.svg`) shifts the corner in a little so a round
  launcher mask keeps it. From 0.8.0 the bullet instead, Matt's pick from the four simpler prompts: a
  solid dot and a short rounded bar on paper, a markdown bullet that is also a reel with tape running
  off it. Redrawn as exact shapes (circle r 124, bar 296 by 96, 30 apart, centred on 1024); the
  foreground is the same mark at two thirds.

## 19. Writing by hand (2026-09-13) - removed in 0.5.2

> Removed the same day at Matt's call ("too much"): the page, the Write entry and the Android
> recognizer (with its 11 MB of native code) are gone. Kept here as the record of what was tried and
> measured. Native generation 5 stays taken.

Matt: write with a finger or a pen on a full-screen page, in the bottom part of the screen, and have
the ink fade away - on the dot pattern.

- **The page** (`ink/InkScreen.tsx`): dotted paper edge to edge (`.app-dots`). The note's words sit
  at the top in display type, bottom-aligned, fading out at the top, with a caret. The bottom of the
  screen - 42% by default, dragged anywhere from 25% to 72% by the grip on its top rule, remembered -
  is the writing band. Opened from a note's header ("Write by hand"); Done reads any ink still on
  the band before closing, and the editor opens on the result.
- **The rhythm.** Write a word or a few; 650 ms after the pen lifts, the ink is read, the words land in
  the note (spaced, washed for a moment), and the ink is lifted into its own canvas that fades out
  over 700 ms, so the band is clean paper again while the next word is already being written. Up to
  three other readings sit above the band as chips; one tap swaps them in. Two keys: new line, and
  take back the last word. Once a pen has touched the band, finger touches there are ignored (a
  resting palm is not writing).
- **Recognition on the phone** (`ink/recognizer.ts`, `ink/InkRecognition.kt`, native generation 5):
  ML Kit digital ink (pinned to 18.1.0 - 19.x carries Kotlin 2.1 metadata this project's Kotlin 1.9
  cannot read). Each piece of ink is sent with the band's size and the last 20 characters of the line
  as pre-context. A language's model (~20 MB) is downloaded from Google's model servers the first
  time the pen is used, then it works offline. Adds ~11 MB of arm64 native code to the APK; no
  libc++ of its own, so no clash with whisper and llama's. The page feature-detects the bridge
  methods, so the pen appears only on binaries that have them; the dev server has a mock.
- **The ink is not the note.** Nothing drawn is stored; handwriting is a way of typing.

## 20. Three ways in, and the tape as an intro (2026-09-13)

Matt: Glyph is used by talking and by typing (handwriting too, briefly - see §19), and the tape,
however good it looks, takes space the words should have.

- **The home dock**: Type as a quiet word on the left, Speak as the screen's one ink pill on the right.
  (A Write entry for handwriting sat between them in 0.5.1 and went with handwriting in 0.5.2.)
- **The tape is an intro.** Both recorders open with it - proof the microphone is live before a word
  has been understood - and once four words are on screen it folds away (its drawer's row animates
  to nothing while the tape shrinks toward the bottom), leaving the words the whole screen. What is
  left is a chip of two small turning reels and the counter, between Discard and Done. A tap on the
  chip brings the tape back to pause or wind back; it folds away again four seconds after it was
  last touched, and never while it is held or winding.

## 21. The reset (2026-09-13)

Matt paused mid-deploy and reset the scope: keep voice → live transcription → markdown by the spoken
cues the guide teaches; remove "summaries and suggestions" (the on-device model, the Formatted
view, projects, the scanner, the server annotate pass) and handwriting; go barebones and hone the
core; a zen, monochrome, developer-feel UI with abstract black-and-white shapes for pictures. He
answered fifteen questions to pin it down, and asked for one over-the-air update per stage.

**Decisions, in his words where they were his:** local cues only, all of the current set; the tape
"is a great UI element, it just gets in the way of the actual recordings" - so it leaves the recorder
and becomes the way to browse spoken notes (a shelf), with the audio kept and playable; one minimal
recorder for the Speak button and the side key; live words as "markdown taking shape"; Done goes
back to the list; list rows are title and time; the format bar goes; star/archive/delete swipes
stay; Settings keeps Type, Theme, Feel, Updates and About, reworked into one calm page; bold
grotesk; pictures are abstract shapes ("no ink inspiration, they're both black and white markdown
notes"), on empty states, guide pages, and the recorder's opening and save.

**Stages shipped:**
- 0.5.2 (OTA): the strip-out; the recorder (`capture/CaptureScreen.tsx`, `Tail.tsx` with
  `tail.ts` marking `#`, `-`, `- [ ]`, `**` dimmed as they land, `Opening.tsx` for the arcs and the
  saved bar); Editor without pending/rewind/suggestion decorations; format bar gone; list rows
  title + time; dock Write · Speak; Settings page (glyph-2a).
- 0.5.3 (APK, native generation 6): the model and its engine gone from the binary (whisper back on
  its bundled ggml; the 1.28 GB model file deleted once at startup if present); recordings kept:
  `capture_stop({ recordAs, append })` writes 16 kHz PCM WAV to `<app_data>/recordings/<id>.wav`
  (appending for a continued note), `set_note_recording` stores `recordingMs` and the segments,
  `delete_note` removes the file, `rec://` serves it with byte ranges; the Tapes shelf
  (`tapes/TapesScreen.tsx`, `TapeArt.tsx`), a "Tapes" word beside Settings.
- 0.5.4 (OTA): the tape player (`tapes/TapePlayer.tsx`): a tape tapped on the shelf comes forward
  with Play under it, the phrases as spoken with the one being heard in ink, a tap on a phrase
  seeking there, the reels turning; the audio comes from `rec://<id>.wav`. A browser has a clock in
  place of the audio.
- 0.5.5 (OTA): the pictures (`art/Shapes.tsx`): nine abstract shapes on currentColor, square, sized
  and dimmed by the page - Blank on the empty list, EmptyArchive, EmptyShelf, and one per guide page.
  The recorder's Opening and Saved live with it in `capture/Opening.tsx` because they animate.
  Matt was given twelve image-generation prompts for the same set, should he want drawn versions.
- 0.5.6 (OTA): the live note lays itself out as it is said (`capture/tail.ts` reads each line's
  kind off its mark; `Tail.tsx` sets headings larger, hangs to-dos and bullets off a dimmed gutter,
  keeps `**` dimmed inline); and the copy pass in Matt's voice across the app - no dashes, no
  semicolons, no ellipses, short direct sentences, full stops (glyph-2a did guide/, notes/,
  settings/; stale tips about the tape and "Fix it after" were rewritten).
- 0.5.7 (OTA): Delete is red, the one hue in the app (the kit's `--glacier-red-9`, themed).
- 0.5.8 (OTA): a left swipe reads Archive, then a red cross for delete: every action of a side is
  shown in the order the swipe reaches it (`SwipeRow.tsx`), the armed one full, the ones passed
  dimmed; the armed delete band is red with the cross in white.
- 0.5.9 (OTA): an armed Archive is a band of ink with the word in paper, so the left swipe reads as
  two squares, white then red on a dark page.

The native rewind (`capture_rewind`, `Streamer::rewind`) stays in the binary, tested and unused by
the page, in case re-recording over a phrase comes back in another form.

## 22. Better words after the recording (2026-09-13)

Matt: "The voice to text model isn't very good. Find a better version we can use if possible, maybe a
bit slower and more phone usage."

glyph-2a measured six models on 73 read-speech clips (clean, and with pink noise plus a 300 Hz
high-pass as a phone-mic stand-in), through the exact commit call, on the Mac and on the arm64
emulator path (no BLAS, the closest thing to the Fold). The live model, base.en-q5_1, makes 10-11%
word errors and streams at 0.85x real time on the phone path; small.en-q5_1 makes 5-7% but streams at
0.21x, so it cannot keep up live, and using it only for commits would queue every phrase behind
speech. large-v3-turbo makes 3-4% at 0.04x: a minute of CPU per minute of speech and a 574 MB
download, the quality ceiling for later. distil-small.en was worse than base here.

So the better model runs AFTERWARDS. base.en stays live, untouched. When a recording is saved
(0.5.3 keeps every one), a job goes on a queue (`capture/refine.ts`, localStorage, one at a time,
never while the recorder is on screen, resumed on launch), and the phone runs small.en-q5_1 over that
take's range of the WAV in the background (`capture_refine`, native generation 7): about 12 s of
four-core CPU per minute of speech on the Fold, the 190 MB model downloaded on first use and loaded
only for the pass. The note's words are replaced with the better transcript - rendered by the same
cue rules, the first take titled, a later one not - only if the note still reads exactly as Done
saved it; the recording's phrases are replaced either way, for the player. The row says "Improving"
while it waits; a switch under Recording turns it off.

Shipped as 0.6.0 (APK, native generation 7) on 2026-09-13. The first real pass runs on Matt's phone:
the emulator's microphone is silent, so no recording could be made there to refine.

## 23. No setext headings (2026-09-13)

Matt: "The formatting is off, it is making the next line a heading and there is no way to stop
typing in headings." His screenshot had a lone `-` under an address line, and in CommonMark a line
of dashes under a paragraph makes the paragraph a setext heading. So typing `-` to start a list
promoted the line above, and the big type looked like a mode nobody could leave. The editor's parser
(`editor/language.ts`) now removes `SetextHeading`: `#` is the only way to a heading, a lone `-` is
an empty list item, `---` is a rule. Tested on the syntax tree. Shipped as 0.6.1.

## 24. Pictures in notes (2026-09-13)

Matt: "add support for inline images".

A note refers to a picture as `![caption](image/<name>)`, a relative path, so a folder of notes and
an `image/` folder beside it would still read anywhere markdown is read. **Photo**, beside Delete in
a note's header, opens the phone's picture picker (`GlyphHost.pickImage`, MainActivity.kt); the
activity decodes the pick at a sane sample size, turns it the right way up from EXIF, caps the long
side at 1600 px and writes a JPEG at 85 into cacheDir/picked/; Rust files it under
`<app_data_dir>/images/<uuid>.jpg` (`save_image`, which accepts only that cache folder) and the `img`
scheme serves it; `delete_note` removes the pictures a note refers to. Native generation 8.

In the editor (`editor/images.ts`) the line keeps its markdown, dimmed and editable, and the picture
is a block widget under it: nothing is hidden, the caret behaves as on any line, deleting the line
removes the picture. A note that opens with a picture is titled by the first line of words under it.
In a browser the picture lives in IndexedDB and reaches the editor as a blob URL, so the screen can be
built and judged without a phone. Shipped as 0.7.0 (APK).

## 25. Animated pictures (2026-09-13, 0.8.1)

Matt: no generated art after all. "For the rest we're just going to use animated SVG icons", with a
new picture for the empty notes list still to come from him.

- **What moves.** Each picture in `art/Shapes.tsx` does the thing it stands for: the archive's last
  line dissolves into dots and comes back, the shelf's two reels turn (the small one faster), the
  welcome bullet lands and its line writes out (the same mark as the app icon), the theme square
  turns over so ink and paper change places, the side key goes in and sound leaves it, the markdown
  lines write themselves in and the box ticks, the tips lid lifts and settles. The recorder's two
  already moved.
- **How.** CSS keyframes in `Shapes.module.css`, on transforms, opacity and dash offsets only, so
  nothing lays out again. Loops of four to six seconds with long rests, so a page is calm most of
  the time. Reduced motion stops them in the pose the markup draws, which is the finished one.
- **Holes are holes.** A reel's hub and the paper dot in the theme's ink half are cut with even-odd
  paths rather than painted in the page colour, so they stay see-through on any background.
- **Still.** Blank, the empty notes list, until Matt's picture arrives.

## 26. A simpler home, and the tape inside the note (2026-09-13, 0.8.2)

Matt: the top bar ("2 notes", Tapes, Settings) had to go. He first asked for a sidebar on a swipe
left, then, since a swipe left on a note already archives it, chose instead: "add a settings cog
button next to the speak button and tapes should be removed, show the tape at the top of each note
and allow playing back the tape within the recording and on the raw mode show transcriptions on the
notes in real time".

- **Home.** Nothing above the Notes title; it keeps the top line's space so it doesn't crowd the
  status bar. The dock is Write on the left, then a cog in a ring the height of the Speak pill, then
  Speak. Next, at Matt's ask, Write became a + in the same ring on the left. With the cog pushed to the
  far right after Speak the row read as illogical (Speak crowded against Settings), so the dock is
  now three places, each with one job: + on the left, Speak centred as the one ink pill, the cog on
  the right (a `1fr auto 1fr` grid). Either thumb reaches Speak, and the two rings balance. The +
  gives a quarter turn when pressed. Ships with 0.9.0. The cog turns a tooth when pressed (`art/Icons.tsx` `Cog`, drawn from its radii). The
  Archive keeps its link at the foot of the list and its own back word.
- **No shelf.** `TapesScreen` and the shelf's picture are gone, and so is the old `TapePlayer`.
- **The tape in the note** (`tapes/NoteTape.tsx`, `tapes/useTape.ts`). A note with a recording has
  a small cassette at the top, with the time, a Play pill, and two words: Note and Transcript. Tapping the
  cassette plays or pauses too, and its reels turn and the tape winds across, so the picture is the
  progress bar. Leaving the note stops the tape.
- **Transcript.** The recording's own phrases, as spoken, in the note's place: the one being heard in ink,
  the ones heard in grey, the ones to come lighter, kept in view while it plays. Tapping a phrase
  takes the tape there. The editor stays mounted underneath, hidden, so nothing typed is lost, and
  measures itself again when Note comes back.
- **Next to it.** The on-device formatter is coming back with a Raw | Formatted toggle;
  that folds into this one control rather than adding a second. Matt's "raw mode" is that
  unformatted note, so the recording's view is called Transcript, not Raw.

## 27. The formatter, on the phone (2026-09-13, 0.9.0, native generation 10)

Matt: "bring back in the contextual AI note summarizer and formatter / meeting summarizer we're
going to make this our last flagship feature and really focus on getting it right ... a segmented
toggle at the top again to switch between raw and formatted notes ... it's okay if it's quite slow i
want it to be super accurate and I want to be able to see the note transforming in real time". Asked
whether to run it through a cloud model on attack.fm: "I'd like it to be an on device model, the idea is
that everything on here will be on device". And: several models to choose from in Settings, Settings
rebuilt on AttackFM's settings components in monochrome, and the back gesture going back in the app.

**What it does.** A note has three views under its header, one segmented control: Raw (the note as
written or spoken, the only one that edits), Formatted (the model's rewrite), and Transcript on a
spoken note (section 26). Formatted, opened for the first time, starts writing by itself and the
words arrive as they are made; a line above says what is happening (loading, reading the note n of
m, writing at so many tokens a second) with Stop, and afterwards which model wrote it and how long it
took, with Redo. The result is kept with the note (`formatted`, `formatted_for`, `formatted_model`)
under a hash of the exact body it came from, so an edit to Raw makes Formatted say "the note has
changed since this was written" with Update. The note itself is never touched.

**The model.** llama.cpp in the app again (`llama-cpp-2` pinned to 0.1.156), with the ggml fix from
0.4.x restored: `vendor/whisper-rs-sys` builds whisper.cpp against llama's ggml (`shared_ggml` in its
build.rs, `extern crate llama_cpp_sys_2` in its lib.rs), and `.cargo/config.toml` names the NDK, API
24 and `armv8.2-a+dotprod+fp16` for llama-cpp-sys-2, which reads none of the toolchain file. Four
models, all Apache-2.0, GGUF Q4_K_M, pinned to a Hugging Face revision with the LFS id as the
SHA-256 (`llm/model.rs`, and the same table in `scripts/fetch-model.mjs llm:<id>`): Qwen3.5 2B
(1.3 GB), **Qwen3.5 4B (2.7 GB, the default)**, Qwen3.5 9B (5.7 GB, for the Fold's 12 GB), Gemma 4
E4B (5.0 GB). Downloaded on demand with whisper's verified downloader, from attack.fm/glyph/models
first, Hugging Face after.

**The engine** (`llm/engine.rs`): one worker thread holding the model; a context sized to the job
(prompt plus the most it may write, in steps of 512, up to 8,192) and remade only when one needs
more, because the KV cache for 8,192 tokens on a 9B is over a gigabyte; the fixed instructions
prefilled once and restored from a snapshot on every later run (measured with the real prompt: 621
of 634 prefix tokens restored, prefill 6,397 ms to 156 ms on the Mac; the saving is larger on a phone); a sampler close to greedy (temperature 0.3, top-k 40, top-p
0.9, min-p 0.05, repeat penalty 1.05 over 256 tokens, seed 42); progress every 120 ms carrying the
whole text so far; cancellation between 128-token prefill chunks and between tokens. Thinking is
switched off through the template (`prompt.rs`, an empty thought), so the first token is the note's.
`ai_commands.rs` is the seam: `ai_models`, `ai_fetch_model`, `ai_delete_model`, `ai_generate`,
`ai_cancel`; `ai://model-progress` and `ai://progress`.

**The prompt lives on the page** (`format/prompt.ts`), so it is tuned over the air; the Rust test
reads it out of the file. A bug worth recording: the test first found the words "`String.raw`" in the
file's own doc comment and ran every measurement with a garbage system prompt; the output was still a
decent note, which is how it went unnoticed for an hour. The extraction now looks for the
declaration and a test checks the prompt starts as it should. With the real prompt, the 4B on four
Apple-silicon cores at 25 tokens a second: keeps every fact of a spoken note, its reasons and who
does what, as task items and bullets, a level 1 title in the note's words, no emoji, no label rows;
it makes a small inference now and then ("at 2" to "2pm"). The 2B on the arm64 emulator (2.5 GB of
RAM) formatted a note in 22 s, load included, and on a note of two words and a picture it invented a
sentence and described the picture; the prompt now says a picture line is copied and never described
and a note of a few words stays a few words. Phone numbers come when Matt runs it on the Fold.

**Settings** is AttackFM's settings kit in ink (`settings/kit/settingsKit.tsx`, `settings.css`): a
list of sections in clustered cards (Type, Theme; Recording, Formatting, Feel; Updates, About), each
opening a pane under `← Settings`, with a live one-line reading per row. Formatting holds the model
picker: Get for a model not here (with the bytes arriving), a radio for one that is, and an "On the
phone" card with Remove and the storage total. About's version, tapped seven times, unlocks a
Developer page (the way Android's own is) holding the developer switch and Projects, parked: the
plan is a git project's code as context for a note's formatting, and the switch holds the place.

**Back** (`core/back.ts`, MainActivity's `OnBackPressedCallback`): a stack of handlers, the newest
first: note → list, settings pane → settings → close, archive → notes, guide page → previous page →
close, the recorder → Done. At the root the app goes behind the home screen and is never finished.
Escape does the same on a desktop.

| Piece | Where |
| --- | --- |
| Engine, catalogue, prompt framing, tests | `src-tauri/src/llm/` |
| Commands and events | `src-tauri/src/ai_commands.rs` |
| Formatted columns | `store.rs` (`set_formatted`), `commands.rs` (`set_note_formatted`) |
| The prompt, the run, the view | `src/app/format/{prompt,formatter,FormattedView}.ts(x)` |
| Models on the page | `src/app/core/ai.ts` |
| Settings | `src/app/settings/{SettingsSheet,SettingsScreen,FormattingPane,panes,developerMode}.ts(x)`, `kit/` |
| Back | `src/app/core/back.ts`, `MainActivity.kt` |
| ggml, once | `src-tauri/vendor/whisper-rs-sys`, `Cargo.toml` patch, `.cargo/config.toml` |

**Added the same evening (native generation 11):** a **Choose your model** page in the welcome
guide after Light or dark (`guide/Guide.tsx` `Model`, the pages named in `guide/pages.ts`), a row per
model with its size, the chosen one in reverse, and "get it now" under the list on a phone; the
**Developer** page grew Set-up rows (that page on its own, the guide from the start) and a **Reset**
card: Reset local data (notes, recordings, pictures, settings, the guide's seen flag; the models and
developer mode stay) and Reset everything (the models directory too, whisper's included, fetched
again when asked for). Two taps, the first arms it for five seconds. Rust `reset.rs`
(`reset_local_data({ models })`) empties the store and removes the directories; the page clears its
own keys and reloads onto the guide. And **the little reader** (`format/Thinking.tsx`): Matt asked for
"a robot doing things or a fun abstract animation" for the wait before the first word, so a robot
made of the app's shapes - a rounded square with two dots and an antenna over three bars - blinks its
antenna with its eyes shut while the model loads, then opens them and sweeps each bar in turn while
the note is read, and leaves the moment text arrives.

Not done yet: the 9B and Gemma 4 have not been run on a phone (the catalogue trusts llama.cpp's
architecture list, which has both); a "meeting" mode with its own prompt; Projects. The other Glyph
session is researching newer local models and building one `ModelPicker` for Settings and the guide.

## 28. Swipes, motion, skeletons, and the tick (2026-09-13, 0.9.2)

Matt, in one evening: animations on Settings loading in and the other pages; skeleton loading
states for everything async; haptic feedback as the model's words arrive; the transcript as the
default whenever a tape plays rather than a tab; no Done word on Settings, swipe to go back; and
"going forward with swiping the other direction too". All page-only, shipped over the air.

- **Swipes** (`core/swipe.ts`, `useSwipeNav`): a quick, mostly horizontal drag across a surface -
  64 px or more sideways, twice as far sideways as up or down, inside a second and a half. Right is
  back, left is forward. On Settings (`SettingsScreen`): right steps out of a pane, then closes the
  page; left goes back into the pane just left, and a line under the list says so. On the guide:
  right is the previous page (the first closes it), left is Next. Drags that begin on something that
  moves sideways itself are ignored: the kit's segmented control (a radiogroup of radio inputs; the
  guide's own choice rows are buttons and swipe fine), sliders, text being edited. The list's rows and
  the editor keep their own gestures, so the swipe is not installed there. The phone's edge gesture
  still goes through `core/back.ts`. Found in the browser: a surface that renders null while closed
  has no element until it opens, so the hook takes an `active` flag; and hot reload keeps an old
  effect's closure, so a change to the swipe's constants needs a full reload to be seen.
- **Motion**: Settings rows and a pane's cards arrive one after another (`--i` set inline, 40 ms
  apart), a pane pushes in from the right and the list pops back from the left, the note's header,
  view control and body rise in a beat apart (on the parts, not on `.screen`, whose transform the
  unfold drives), the list's first nine rows arrive staggered. All off under reduced motion.
- **Skeletons**: paper-3 blocks the shape of what is coming, breathing. The list while notes are
  read; the Formatted view until the kept text is known (which also fixed a race: the view could
  start a run before `getNote` answered, and format a note that already had a version); the
  transcript's phrases while a recording's words load; and `setk-skeleton*` / `setk-row--skeleton`
  in settings.css for the model picker.
- **The tick** (`FormattedView`): the phone's lightest haptic, `selection`, once per progress report
  that brought new text, never more than every 100 ms.
- **Transcript on play**: the segmented control is Raw | Formatted only; on a spoken note the
  transcript takes the screen while `tape.playing` and steps aside when it stops.
- **The side key's phone** (`art/Shapes.tsx` `SideKey`): a wide slab with corners barely rounded,
  zoomed in on the edge, and the key large on its right; Matt: "not a weird super tall phone".

## 29. The note's own menu (2026-09-13, 0.9.3)

Matt: "remove the photo button at the top, just expect images to be pasted in, and add a press and
hold context menu that overrides the system one; add the usual copy paste but also add image etc".

- **Measured first.** A long press in the editor fires `contextmenu`; preventing it keeps the word
  the press selected, handles and all, and Android's own Cut / Copy / Read aloud bar never appears
  (emulator, side by side with a control run where it did). So the menu is the page's alone: no
  change to MainActivity, no subclassing of wry's WebView. The page can WRITE the clipboard on a tap
  (`navigator.clipboard.writeText`) but not read it (`readText` and `read` both "Read permission
  denied" in the WebView), so Paste needs one native method, `GlyphHost.readClipboard()`, asked of
  the generation-12 native batch; until it exists Paste is not shown and the keyboard's own
  paste, pictures included, still works.
- **The menu** (`editor/ContextMenu.tsx`): a band of paper-2 above the selection with Glyph's words
  along it - Cut and Copy when something is selected, Paste when the activity can read the clipboard,
  Select all, Add image (the picker that used to be the Photo word) - and a second, quieter band for
  the formatter's selection edits (Shorten, Expand, Make a list, Fix grammar), planned
  as `format/edits.ts`; the menu takes them as props and renders them greyed with a reason
  while the model is not on the phone. It leaves on a touch elsewhere, a scroll, or the back gesture,
  and a press on it never takes the editor's focus.
- **Paste, on 1.0.0.** `GlyphHost.readClipboard()` landed in the 1.0.0 activity (JSON `{ text }`,
  `{ path }` for a picture shrunk into the cache, `{ error }` or `{}`); the menu inserts the text,
  adopts the picture, and does nothing for the other two. Checked on the emulator with the release
  build: Select all, Cut (109 characters to none), Paste (back to the same 109).
- **Five words on a phone held upright (1.0.1).** The band was running off the right edge with "Add image"
  cut mid-word (emulator, 412 dp: 443 dp of words in 395). Now the words sit snug enough to share
  412 dp, and on a narrower screen the band scrolls sideways and fades at whichever end has more
  (`data-more` on the row, a mask in the CSS): a word fading out reads as "and more", a word cut
  off reads as broken. The menu also measures itself with layout sizes, not the drawn box, because
  the entrance animation starts a touch smaller and had been putting it 8 dp off.
- **The Formatted view is a note (1.0.2).** Matt, from the Fold on 1.0.1: "I can't scroll or
  interact with the formatted one". Two causes. The pane's `flex: 1` did nothing inside the note's
  `.body`, which is a plain block, so the pane was the height of its words and a long rewrite ran
  off the bottom with nothing to scroll (measured on the emulator: pane 356 of a 639 body, and a
  40-item rewrite 2821 tall in a 631 scroller once fixed with `block-size: 100%`). And the editor
  was read-only, with Android's own selection bar on a long press. Now it scrolls, it has the same
  press-and-hold menu as the note (Cut, Copy, Paste, Select all; no Add image, a picture makes no
  sense in the model's text), and it can be edited: an edit is kept as the formatted text after a
  400 ms pause and on leaving, with the hash it stands for, and marked `edited` in place of a model
  (`format/pipeline.ts` EDITED, which sorts above every model) so no pass revises it and the line
  reads "Edited by you." The note changing, or Redo, asks the model again. While a pass is writing
  the text is read-only, so the two never type over each other; the pipeline's own appends are told
  apart from the person's by a flag around the dispatch, or a landed draft would have been kept as
  an edit.
- **Links survive the model (1.0.3).** Matt: "AI formatting drops links" - a Notion send leaves
  `[the words](https://www.notion.so/…)` in a list item, and the rewrite lost it. Kept by
  construction, not by asking (`format/links.ts`): before the note goes in, every `[words](url)`,
  `<url>` and bare address is swapped for a token the model can copy, `[words](link-1)` or
  `<link-2>`, the way a picture line is kept whole; after, the tokens are swapped back, taking
  `link-1`, `link 1`, `<link-1>` or `(link-1)` however the model wrote them and keeping the model's
  words around a markdown link. A token that never comes back is not a lost link: its words are
  made the link again if they survived, otherwise the link is added at the end of the note on its
  own line. The prompt asks too. Measured on the Mac with the 4B (`llm::tests::
  keeps_a_link_token_where_it_was`): both tokens kept in a list item, no address invented. On the
  emulator with the 2B (1.0.3): a Notion link in a task item and a bare address both came back
  whole in 7 s, though the 2B moved the Notion link into the title; the 4B keeps it on the item.
- **An empty note is not formatted.** Found on the way: opened on a note with nothing in it, the
  Formatted view started a pass and the 2B wrote a meeting agenda from nothing. The view and
  `formatter.start` now refuse an empty body, as the queue already did.
- **Apply (1.0.3).** Matt: no way to keep the formatting. The Formatted view's line carries
  Apply, beside Redo, whenever a finished text is on screen and the note has not moved on (an edit
  still being typed is flushed first). The screen replaces the note's document through the Raw
  editor, so the editor's history covers it, switches to Raw, and says "Applied to the note." with
  Undo for eight seconds. The formatted version is kept against the new body's hash and marked
  `applied` (sorts above every model, like `edited`), so neither the queue nor a revision formats
  the text it just applied; Undo puts the old words back and re-keeps the formatted version as it
  was. Not shown while a pass writes, for a stale text (Update first), or for one already applied.

## 29a. The robot: Format, Summarize, Enhance (2026-09-14, 1.0.5)

Matt: "add more features around the AI in addition to format, I want a summarize and an enhance;
make all of these buttons instead of the segmented toggle, make a robot drop-down button for these
options".

- **One button.** The Raw | Formatted segmented control is gone. In the header, beside the cog,
  a ring with a robot's head and a caret (`format/RobotMenu.tsx`, the glyph in `art/Icons.tsx`)
  drops a card: Format, Summarize, Enhance, each with a line on what it does, the one showing
  marked with a dot, and, while one shows, "Back to note". Choosing opens that mode's view over
  the note (`format/FormattedView.tsx`, now the robot's view for every mode); Close in its line,
  "Back to note", or the phone's back gesture returns to the note. The ring fills with ink while
  a mode shows, so the header says which state the note is in. The card hangs from the header,
  which now sits above the tape and the note (`z-index` on `.header`): its entrance animation's
  transform makes it a stacking context, and without the z-index the card drew behind the tape.
- **Three modes, one machine** (`format/modes.ts`). Each mode is a prompt (`prompt.ts`:
  SYSTEM_PROMPT is Format's, SUMMARIZE_PROMPT and ENHANCE_PROMPT beside it), a budget
  (`budgetFor`: a summary gets half the note's tokens, an enhancement three times), and a kept
  text per note. The pipeline, the passes (smallest model first), the link tokens, the streaming
  view, editing, Apply and Undo are shared: `runPipeline` takes the mode, its events carry it, and
  `useFormatter(noteId, mode)` looks up the kept text itself and listens only to its mode.
- **Where the texts live** (`format/results.ts`). Format's stays in the note's store (SQLite on
  the phone): it is what the background queue writes after a recording. Summarize and Enhance
  are asked for by hand and kept on the page under `glyph-ai-results`, per note and mode, with the
  same hash and model as the store's columns, so all three modes read alike. Moving them into the
  store is a native change (a column each, a generation bump) for a later APK; this is what ships
  over the air. The key is on the reset list.
- **The prompts, measured with the 4B on the Mac** (`llm::tests`, which now read any of the
  page's prompts by name). Enhance: at least as long as the note, every one of fifteen facts kept,
  no room run out. Summarize took three tries: the first prompt gave a "summary" 1.5 times the
  note (a sentence restating every task, then the tasks again, then facts again); firmer words
  did not help; an example did - the Format prompt's plumber note and its four-line summary - with
  "one short sentence saying what the note is for, never a run through its contents" and "nothing
  else: no bullets repeating the tasks". The 4B then wrote a heading, one line and four task items
  under ten words each. A summary may drop a second-order detail (the report's due date behind
  "block Friday afternoon for it"); the test asks for the tasks' own whens.
- **Wording elsewhere.** The Formatting pane and the model guide said "open Formatted on a
  note"; they now say to tap the robot.
- **On the emulator with the 2B** (1.0.5, then 1.0.6): the dentist note summarized in 26 s to a
  heading, one line and three tasks; enhanced in 58 s to a paragraph and three tasks - with
  reasons the note never gave ("need a dental check-up before my morning routine"), which is the
  2B inventing where the 4B, in the Mac test, did not. Enhance is the mode that leans hardest on
  the model; the Fold's 4B pass has the last word. Each mode's kept text came back on switching:
  Summary, Enhanced, and Format's "Edited by you" from the earlier edit.
- **Tables survive the model too (1.0.7).** With tables in notes (§37's tables by voice, drawn by
  `editor/tables.ts`), a rewrite would mangle them. `format/tables.ts` swaps each GFM block - a
  header row with pipes, a delimiter row, every following row with pipes - for one line before
  the model and back after, verbatim; tables go first, then links, so a link in a cell is inside
  the block, and back in reverse. The line is shaped like a picture, `![table-1](table)`: measured
  with the 4B on the Mac, a bare `[table-1]` was dropped as noise even with a prompt line asking
  for it, while a picture-shaped line is copied every time, since the prompts have always asked
  that of pictures. Format and Enhance keep it where it was and append a block whose line never
  came back; a summary may leave a table out. The prompts say to copy the line and never draw a
  table of their own (`no tables` stays, meaning new ones). On the emulator with the 2B: a
  three-row bug table typed into a note came back whole and drawn after Format, all cells in
  place - at the end of the note, because the 2B dropped the line and the fallback appended the
  block. The 4B keeps the line where it was.
- **The 2B invents on short notes.** Twice on the emulator, Format on a one-line note ("bug bash
  notes from friday heres what we found") came back as a bug report with a root cause, an impact
  and three actions the note never had; the same 2B on the dentist note enhanced it with reasons
  it never gave. The prompts forbid it and the 4B obeys; the 2B does not, for a note with little
  in it. Worth a rule: skip the 2B's draft pass when the note is short, since the 4B answers a
  short note in seconds anyway, and the draft is where the inventions show.
- **1.0.6, one line.** Choosing Enhance while the Summarize view was open came up empty: the
  view is the same component for every mode and was not remounted on a mode change, so its
  once-per-mount start (the guard that keeps Stop stopped) never fired for the new mode. The
  view is now keyed by mode: a change of mode is a fresh view, with its own editor and its own
  start.

## 29b. The update card, in foil (2026-09-14, 1.0.8)

Matt: "the update banner is kind of ugly with the solid blue, can you update it to be like a white
holographic design". The card (`notes/NotesList.module.css`) is now white in both themes - the
one white card on black paper is the point - with a foil sheen: a pastel spectrum (pink, mint,
lemon, lavender, in oklch at chroma 0.08 so it reads as colour and not a tint) drifting slowly one
way under a band of white light crossing the other, the way a holographic sticker catches a lamp.
Near-black words, a black pill for the action, an inset white hairline and a soft drop shadow so
it sits on light paper too; the progress bar is black on a faint track. Reduced motion stops the
drift. Checked at phone width in both themes; the card only appears when an update is waiting, so
the check was a card injected with the module's classes.

## 29c. Suggestions, inline (2026-09-14)

Matt: "render suggestions inline for stuff like adding a list item as a Notion task and whatnot; I
want the note to feel more alive with the integrations while remaining minimalistic".

- **What it is.** A quiet word at the end of a line for what a plugin could do with it, tapped
  to do it: "Notion" after a to-do that is not a task yet, once the note has a board. A small
  outlined word in the faintest ink, a step smaller than the line, with a hairline of its own
  ink at less than half strength so it shows on black paper and on white without shouting.
  Nothing else on the page changes. While it runs it says its busy word ("Sending") and cannot
  be tapped twice; once the line has become what was offered (a link to the task) the plugin no
  longer offers it and the word is gone. It is never on the line being typed: it would sit
  against the caret and jump with every letter.
- **Where it comes from.** A plugin extension point (`plugins/types.ts` `suggest(noteId, body)`,
  gathered by `plugins.suggestions`), pure and read on every change of the document - the
  answers are a regex per line, and a note of five hundred lines costs nothing. It needs the
  `notes` permission like the other things that change a note; the registry refuses a plugin
  that offers words without it. The Notion plugin offers one per unsent item when a board is
  linked; each runs the same send as the swipe, so the line becomes the task's link and is one
  undo. Other plugins can offer their own (a repo address that could become the note's project,
  say) without the editor knowing what they are.
- **How it is drawn** (`editor/suggestions.ts`). A widget decoration after the line's text
  (`side: 1`), rebuilt on document and selection changes and on a busy effect, so the note's own
  words are never touched and the swipe on the line still works. The widget ignores the editor's
  events and stops its own, so a tap is a tap and not a caret move. Verified in the browser at
  phone width in both themes and by unit tests: the word on every offered line but the caret's,
  following the note as it changes, the busy word while it runs.
- **On the emulator** (1.0.9, a board record written by hand): a note of three to-dos opened
  with the three words in place within a third of a second; tapping one said "Sending" and gave
  the account error on the line, since the emulator has no Notion sign-in, then offered the word
  again. Once, right after a relaunch, a note opened with no words until the caret moved: the
  Notion plugin's readiness is settled by an asynchronous check of the binary at start-up, and
  the editor's first build can precede it. The swipe has the same window. Worth a nudge from the
  registry when readiness changes, later.
- **Later.** A first nudge before anything is linked ("Send to Notion…" on the first to-do,
  opening the board picker) needs a way for a plugin to open its own picker from a note; and
  the Projects plugin could offer "Project" on a line with a GitHub address.

## 29d. Apply, three ways (2026-09-14, 1.0.9)

Matt: "there is no way to accept, append or prepend a summary or enhancement". Apply replaced the
note, which is right for Format and wrong for a summary that belongs above the note or an
enhancement someone wants under it. The Apply word in the robot's line now opens three -
Replace note, Add above, Add below - and Back. Above puts the text, a blank line, then the note;
below puts the note, a blank line, then the text; all three go through the note's editor, so the
history has them, and the notice says which happened ("Added above the note.") with Undo, which
puts the old words back and the kept version back to what it was. The kept text is marked applied
against the hash of the note as it now is, not of the text, so the queue and the passes leave it
alone until the note changes again. Verified in the browser: all three ways, the notice, Undo.

## 29e. The item mark: one form for a linked item (2026-09-14)

Matt: "we also need a common format for linking Notion pages to list items, as the AI will change
how this looks when formatting or enhancing". A sent item's words used to become the link,
`- [ ] [Buy milk](https://…)`, and a rewrite that moved or dropped the link left the item looking
unsent (the 2B moved one into the title): the suggestion offered it again, and Notion would have
had it twice.

- **The form.** The words stay plain and the item ends with a mark, a link whose words are the
  lowercase name of what it is linked to: `- [ ] Buy milk on the way home [notion](https://…)`.
  Generic on purpose: `[github](…)` would mark an issue the same way, and the editor would draw
  it the same way. Written in one place, `core/itemLinks.ts` `linkedLine`, so the swipe, the
  inline suggestion, "Send list to Notion", the voice commands and the recorder's live linking
  (`applyLinks`, which puts the mark at the end of an item, or right after words in a sentence)
  all write it without a change of their own. Recognised alongside the old form, so a note from
  before is never sent twice; `unsentItems` answers an item's words without its mark.
- **Drawn.** `editor/links.ts` draws a mark - the whole `[notion](address)`, when it is the last
  thing on an item's line - as one small solid pill with the name on it: the done twin of the
  outlined suggestion pill, so a note reads at a glance: outlined could be a task, solid is one.
  On the caret's line it is written out in full, like a short link. An ordinary link at the end
  of an item (`[the board](…)`) is not a mark: its words are not one lowercase name.
- **Through the model.** A mark is protected like every link (`format/links.ts`), as
  `[notion](link-1)`, and the three prompts say to keep it at the end of its item. The
  protection remembers the item's words for a mark, and a mark whose token never comes back goes
  onto the item found again by those words - three words in five, letters and digits, three
  characters or more - before the old fallbacks (wrap the words, append at the end). Measured on
  the Mac with the 4B (`llm::tests::keeps_an_item_mark_at_the_end_of_its_item`).

## 29f. A note called Glyph (2026-09-14, 1.1.3)

Matt, from the Fold: he said "add a note to the Glyph note saying testing if this works" and got a
new note titled "Add a note to", the rest gone. Reproduced with `planCommand` against his notes:
he has a note called Glyph, the keyword was not said first, and `findKeyword` took the note's
name mid-phrase for the keyword - the words before it became the note, the words after it were a
command nothing could read, and at the end of the take they were dropped. Said with "Glyph" first,
every phrasing of it already parsed, his included.

- **The fix** (`capture/command.ts`): an occurrence of the word that a preposition leads and
  "note", "page" or "list" follows ("…to the Glyph note") is a name, not the keyword, and the
  search moves on; the keyword still counts first in the phrase or on its own later. So the phrase
  without the keyword is plain words and nothing is lost, and with it the Glyph note can be named.
- **Trying any phrase without a microphone** (`capture/engine.ts`): `?simulate=say&say=a|b` speaks
  the phrases given, one per bar, the way the fixed scripts do. Both cases were run through the
  real recorder in the browser: the card "Add to Glyph: Testing if this works", a spoken yes, and
  the line at the end of the Glyph note; and the keyword-less phrase kept whole as a new note.
- **Still open, for the recorder:** words after a keyword that never resolve into a command are
  dropped at the end of the take. They should go back into the note as words, with a line saying
  the command was not understood.

## 29g. On this phone: the AI card, Local only, and the pinned heading (2026-09-14, 1.1.4)

Matt: "highlight the local AI part of this, making sure the app can be run totally without a
server if desired; a better, consistent AI card that renders when it's thinking, and it should
render things like real phone hardware usage". And, for the list: "better iconography for pinned
notes, make the label more apparent for the group, avoid individually repeatedly marking things
like having a pin on each note".

- **The AI card** (`format/AiCard.tsx`). One face for the model at work, drawn by the robot's views
  while a pass is writing and nothing has arrived yet, and offered to the review screen: the
  model and its size on disk, a pill saying "On this phone", what it is doing and how fast (the
  same lines as before), the little reader in the corner, and the phone underneath as a grid of
  readings with hairline bars - cores, memory, battery from what the page can read itself
  (`format/deviceFacts.ts`: hardwareConcurrency, deviceMemory, getBattery), and from native
  generation 14 the engine's own readings every tick (`Hardware` on Progress: its memory of the
  phone's, its share of the cores, threads of cores, the hottest thermal zone). What nothing
  reports is left out rather than guessed. "Nothing leaves the phone." closes it, with Stop.
- **Local only** (`localOnly` in preferences, a switch in Settings > Formatting under "On the
  phone"). While it is on: the update check never asks the box (`core/ota.ts`), a model download
  is refused with a sentence (`core/ai.ts`), the voice model is not fetched and the recorder says
  why, the larger voice model is not fetched and the better words wait (`capture/engine.ts`,
  `capture/refine.ts`), and every plugin that declares the network permission is off
  (`plugins/registry.ts`, which now follows preference changes and tells its listeners). Glyph
  runs from what is on the phone; turning it off restores everything.
- **The readings, native generation 14** (`src-tauri/src/llm/hardware.rs`, 1.2.0). The engine's
  reporter samples the phone with every progress report, about every 120 ms: the app's resident
  memory from `/proc/self/statm`, the phone's total and available memory from `/proc/meminfo`
  (the `device` module's parser), the process's CPU time from `/proc/self/stat` turned into a
  percentage of one core over the time since the last sample (640 is six and a half cores busy),
  the engine's threads of the phone's cores, and the hottest thermal zone under
  `/sys/class/thermal` where the phone lets it be read - many do not, and then there is no
  reading rather than a guess. The reading rides on `Progress` as `hardware`, absent where there
  is no `/proc` (the Mac's tests), and the card draws whatever arrives. Reading three small files
  costs microseconds. The parsers take text, so a real phone's files are the unit tests.
- **The pinned heading** (`notes/NotesList.tsx`). The pin left every pinned row and sits once on
  the group's heading, tilted as it was; the heading grew a step and darkened an ink, with a
  hairline under it, so the group reads as a group. Others keeps its label without an icon, so
  the pin stays the pin. Swipes are as they were.

## 29h. The formatter's tidy-up (2026-09-14, 1.2.1)

Matt: "the formatter can do things like double nest links and not clean up Notion task links to
simply say notion, and other basic formatting tasks". Two pure passes in `format/clean.ts`, both
in the pipeline:

- **Before the model, `cleanNote`.** An item linked the old way - its words as the link,
  `- [ ] [Buy milk](notion-url)`, whole or mid-words - becomes the mark form, `Buy milk
  [notion](url)`, so the model sees words as words and the mark as the one thing to keep. Links to
  anywhere else are left as they are. The hash stays the note's own.
- **After the links are back, `cleanRewrite`.** A link nested in a link's words, which a small
  model writes now and then (`[[Buy milk](url)](url)`), unwinds a layer at a time and the inner
  one wins. An item's mark is once and last, wherever the model put it or however many times.
  Then the plain markdown the prompts ask for: `-` bullets for `*` and `+`, task boxes with their
  spaces and a lowercase x, a space after a heading's hashes, no trailing spaces, no run of blank
  lines. Words are never touched; the test that proves it feeds the prompt's own example through
  and gets it back unchanged.
- **Marks are named things.** Restricting the mark grammar came out of this: `[docs](url)` at the
  end of "read the docs" is one lowercase word in a link and was a mark called docs, drawn as a
  pill. Now a mark's name must be a plugin's id (`core/itemLinks.ts` `registerMarkName`, which the
  registry calls with every plugin as it loads; "notion" is built in), everywhere marks are read:
  the editor's pill, the formatter's protection, and both passes here.
- **And one more guard** in `format/links.ts`: a link whose token vanished is never restored
  around words that already sit inside another link, which was a second way to nest.

## 29i. The gist under every title (2026-09-14, 1.2.2)

Matt's board: "live on-device AI summaries on the home list". One quiet line under each note's
title in the list, what the note is about, written on the phone in the background.

- **The line** (`format/gist.ts`, GIST_PROMPT in `prompt.ts`): at most ten words in the writer's
  own voice, no markdown, no closing punctuation; a note with many things in it gets a line about
  what they have in common, not a list of them - the first prompt without that rule gave the
  weekend note fifteen words naming every errand; a second example fixed it, measured with the 4B
  (`llm::tests::gists_a_note_in_one_short_line`). The answer is tidied to one bare line and cut at
  ninety characters on a word (`tidyGist`).
- **The runner.** The list hands `useGists` the notes it shows; a module-level runner works through
  the ones with no gist, or a gist from an older body, one at a time, newest first, only while the
  app is on screen, with the smallest model on the phone (speed over care for a line), forty
  tokens each, links protected as tokens. Each gist is kept in `glyph-ai-results` beside the
  summaries with the hash of the body it came from, so a note that has not changed is never asked
  twice and a note that has shows its old line until the new one lands; a note the runner could
  not gist is left alone for the session. The engine serialises this with the format queue and the
  robot's own passes. Nothing leaves the phone, and Local only changes nothing here.
- **Drawn** in `notes/NotesList.tsx`: one line, the third ink, ellipsised, fading in when it lands;
  nothing at all until then, so a phone without a model looks as it did.

## 30. Talking to the recorder (2026-09-13, 0.9.2 to 0.9.4)

Matt, three asks in one evening: stop recording when the side key is let go ("surely the phone
reports what button states we're in"), send words to a note by naming it ("listen for keywords like
add to <note title> … show indications in real time … move the text over and write it out on the
correct note"), and teach the spoken markdown while he pauses. Then, from the Fold: "It missed the
mark quite a bit on the real time markdown formatting of the message creating a simple list of
items".

**The side key cannot be seen let go.** Android keeps the power key from every app so none can
stop a phone turning off: no key event, no accessibility event, and `getKeyCodeState` exists only
inside system_server (it is in `InputManagerService` but not in `IInputManager.aidl`). Samsung
Knox can send press and release intents, but only on a phone enrolled in enterprise management. So:

- **A press stops it** (native generation 12, 0.9.5). While a recording runs the screen is kept on
  (`FLAG_KEEP_SCREEN_ON`, `GlyphHost.setCapturing`), so the screen going off means the key was
  pressed: MainActivity's `ACTION_SCREEN_OFF` receiver, registered only during a recording, calls
  `window.__glyph.screenOff()`, and the recorder saves as Done does. A held press does not turn the
  screen off, so letting go of the hold that started it does not stop it. On an older APK the page
  finds no `setCapturing` and keeps saying "Hold the side key again to stop".
- **Stop when I go quiet** (Settings > Recording, off by default; `capture/quiet.ts`): four seconds
  of quiet after words, judged against a noise floor that follows the room, with the recogniser's
  words (which lag speech) only ever making the wait longer. Nothing stops before the first word.
- **Rings from the key** (`capture/SideKeyWaves.tsx`, `sideKey.ts`): on side-key recordings, three
  rings rise from the screen's edge beside the key, swelling a little with the microphone's level.
  Android does not say where buttons are: the Fold line (`SM-F9`) is 47% down the right edge, other
  phones a guess, and Settings > Recording has a slider with a preview to move it. The spot follows
  the key round the screen as the phone turns.

**Naming a note** (`capture/route.ts`, 0.9.3). "Add to", "add this to", "put that in", "send it
to", "switch to", at the start or the end of a phrase; "new note" on its own. The spoken name is
matched against the notes' titles by words, by letter pairs (so "week end trip" is "Weekend trip")
and by prefix, and only a clear winner counts: a command that moves words to the wrong note is
worse than a missed one. While the name is still being said a chip guesses "Add to **Shopping
list**"; when the phrase commits the chip fills with a tick, the words slide off, the note's last
lines appear above them (the context strip, which now always shows which note is being written on)
and the take writes itself out below. A name that fits nothing says so and the words stay. The
whole take moves, so "oat milk, add to shopping" and "add to shopping, oat milk" land the same;
splitting one take across two notes is not done.

**Tips in a pause** (`capture/tips.ts`): after 2.5 s without new words, one line above the buttons,
"Say **Check box** to make a to-do", a different one each pause, gone when talking resumes. The
routing tip names one of his own notes. `?simulate=route` speaks a note that routes itself, for
watching all of it without a microphone.

**Lists said the way people say them** (0.9.4, `capture/markdown.ts`). His first real list, as
Whisper wrote it: "List item is weed. List item is Culver's onion ring. The next list item is
Culver's cement mixer ice cream. And lastly, the final item that we need on our list is a gallon of
black coffee." The cue rules only knew "bullet point", so it came out half prose. Now:

- An item phrase names an item and gives it ("list item is", "the next item is", "another one is",
  "item number three is", "the last thing we need on the list is") and becomes a list line of just
  the item. A bare "item" or "thing" needs an ordinal or the word "list" beside it, so "the thing is,
  I'm tired" and "the item is broken" stay sentences.
- A sentence that announces a list ("add a list below", "here's my shopping list", "make a numbered
  list") keeps its words and opens a list; short plain sentences after it (five words or fewer, not
  "I'm…" or "it's…") are its items until a longer sentence ends it. After a cue list ("bullet point,
  eggs") a short "Thanks." stays a reply.
- A list keeps its kind: begun with "number one" it stays numbered through "the next item is", and a
  pause between items no longer breaks it. Item phrases inside cues are stripped too ("number one,
  list item is weed" is "1. Weed").

## 31. Pins, and swipes that show what they do (2026-09-13, 0.9.5)

Matt: "redo the archive delete start ui, rename star to pin and show a pins icon on the top right".

- **Pin, not star.** The swipe right is Pin (Unpin on a pinned note) and a pinned note carries a
  small tilted pin in its row's top right corner, in the meta line's grey, dropping in when it is
  pinned. Pinned notes still sit first. The store keeps its `starred` field; only the word changed.
- **Pinned is a category** (1.0.0, `notes/groups.ts`). Matt: "put pinned notes in a category above
  the rest of the notes in lists". Pinned notes gather under a small PINNED label and the rest under
  OTHERS, both in the rows' meta voice so they read as dividers, not headings. With nothing pinned
  there are no labels and the list is one run as before; the archive is never split.
- **The gap is the action** (`notes/SwipeRow.tsx`). A swipe no longer uncovers a line of large words.
  The gap the row leaves holds the action's picture in a ring and its word under it: the ring fills
  as the swipe nears the detent, the picture grows into place, and at the detent the ring closes,
  the motor ticks and the whole gap fills, ink for Pin, Archive and Restore, red for Delete, with
  the picture doing its small move (the pin pressed in, the box dropped, the bin shaken). Armed on
  Archive, a line under it says "Further to delete"; past that detent the picture becomes the bin.
  The pictures are the app's own strokes (`art/Icons.tsx`: `Pin`, `ArchiveBox`, `Unarchive`, `Bin`).

## 32. Items into a note's list, and short links (2026-09-13, 0.9.6)

Matt reset the focus to a few core features ("I just want a few core features to work"): items spoken
into a note's list, projects as context for the local AI, Notion tasks, and short links. The models page
and the wake word wait. This section is the first two; Notion and projects follow.

**"New item for AttackFM"** (`capture/route.ts` `kind: 'item'`, `capture/listAppend.ts`). Said in the
recorder, it names a note (the same forgiving match as "add to", so "attack FM" is AttackFM) and the
item goes into that note's list, not onto the take:

- The item can come in the same breath ("new item for AttackFM, fix the login bug") or as the next
  phrase, the chip saying "Say the item for **AttackFM**" and then showing the words as they are said.
  "New items" or "new tasks" takes every phrase until a pause longer than a paragraph's, and a phrase
  that lists ("update the readme, ship the APK and tell Sam") becomes one item each.
- The list is the note's last run of list lines; items go on its end in its style (`- [ ]`, the next
  number with the same delimiter, the same bullet, the same indent), after any lines that continue the
  last item. A note with no list gets one at its end, to-dos when "task" or "to-do" was said.
- The note is written at once, while the take carries on where it was; when the take is itself writing
  onto that note, its drafts build on the grown body. The landing preview shows the list's last lines
  and the new ones arriving with a tick, and the chip says "3 added to **AttackFM**".

**Short links** (`core/shortUrl.ts`, `editor/links.ts`). "Don't show the full link path just show the
first 3 chars after the tld then a ... and the last 3 chars": a link's address shows as its host, three
characters, an ellipsis and three characters, `notion.so/att…c0d`, with the whole address as its title.
In the editor it is a replace decoration over the `URL` node, the first thing the editor draws in place
of what is written, so it steps aside on any line the selection touches (the address is written out in
full there, to edit) and while an IME composes. The recorder's words and the list's titles shorten
addresses the same way. The stored text never changes.

## 33. Talking into a note, and the note's settings (2026-09-13, 0.9.7)

Matt: "i want to be able to start talking on a note and also I don't see the speak icon show up on
the note or a settings button on the note to be able to manage it as a project or something and I
don't see the cassette at the top of the note".

- **A cassette on every note** (`tapes/NoteTape.tsx`). A spoken note's tape plays as before, with
  Speak as a word beside Play. A note never spoken into shows the same cassette, quieter, labelled
  with its title and BLANK, "Nothing recorded yet" and a Speak pill; tapping the cassette is Speak.
- **Speak on a note** opens the recorder aimed at that note (`noteId` on the capture screen): the words
  go on its end whatever memo mode says, the recording joins the note's tape, and Done comes back to
  the note, read fresh from the store so its body and a Formatted comparison are current. The note's
  typing is flushed before it goes.
- **The note's settings** (`editor/NoteSettings.tsx`): the header is `← Notes` and a cog; Delete moved
  into the cog's sheet, from the bottom over the dimmed note, with Pin (or Unpin) and Archive, then
  "Linked to": Project (a GitHub repo the AI reads) and Notion board, shown before they work, and
  Delete in red at the bottom. Back closes the sheet before it leaves the note.

## 30. Formatting in passes (2026-09-13, 0.9.8)

Matt, with a rough spoken note on the Fold: "the quick format wasn't really fast, maybe the quick
format needs to reformat a few times with slower models to make revisions". The same shape whisper
already has (base.en live, small.en after), applied to the formatter.

- **Passes** (`format/pipeline.ts`): the models on the phone from the smallest up to the one chosen
  in Settings, smallest first, so a draft comes quickly and the chosen model has the last word. Each
  pass writes from the note itself rather than from the draft (a careful model anchored to a careless
  draft keeps its mistakes; from the note it kept every fact in the samples) and is saved as it lands
  (`formatted`, `formatted_for`, `formatted_model`), so a killed app keeps the best it had. One run per
  note, shared by whoever asked, watched through `subscribe`: the draft streams into the view; a
  revision keeps the draft on screen and shows only its pace, then swaps the text in when it lands.
  A note whose kept text is a draft by a smaller model gets only the passes above it.
- **The queue** (`format/queue.ts`): a spoken note is formatted without being asked, after the whisper
  post-pass has finished with it (read off the `glyph-refine-queue` key, so the draft is not written
  from words about to be replaced), one note at a time, never while the recorder is on screen or the
  app is hidden, persisted in localStorage like the refine queue. Hooked by the recorder's Done
  (`enqueueFormat`) and started from App (`startFormatting`), two lines.
- **The view**: "Draft by Qwen3.5 2B. Revising with Qwen3.5 4B, 0:42." with Stop, which keeps the
  draft; then "Qwen3.5 4B, 1:20." with Redo, or "changed since" with Update.
- **A project's pack** (`projects/projects.ts`) goes in with every pass as the
  system message's context, so it is part of the snapshotted prefix, and its version is folded into
  `formatted_for` (`noteHash`), so a re-read pack reads as an edit.
- **Measured on the arm64 emulator** (2B only, so one pass): a two-line note drafted in 28 s into a
  title and two task items; the background queue, given a stale note, drafted it again within 30 s
  of launch with the app untouched. The draft-then-revise path needs two models on one phone and is
  covered by the unit tests until the Fold has both.

## 34. "The next item is", said in two breaths (2026-09-13, 0.9.8)

From the Fold, after 0.9.4: "1. The Grand Canyon / 2. Spain / 3. The next item is / Paris. / The next
item is. Greece." Whisper commits a phrase at a breath, so the item phrase and its item arrive as two
phrases; and when it hears a list being dictated it sometimes writes its own "1. … 2. … 3." inline.

- **An item phrase with no item** ("The next item is.", or inside a cue, "Number three, the next item
  is") is held, and the next sentence is taken as the item, whatever its length, in the list's kind: a
  held numbered cue keeps the count. If a second item phrase comes instead, or nothing follows, the
  held words are kept as words.
- **Whisper's inline numbering** (`inlineNumbering`): two or more markers counting up by one within a
  paragraph are split into "number N," cues before sentences are read, so the numbered rule lays them
  out, and a piece that is only an item phrase waits for the next phrase. A year ("1990.") or a lone
  "2." is not a run.
- **Formatting after a recording** (staged passes, `format/queue.ts`): Done queues the note
  after its refine job, and the queue is paused while the recorder is on screen.

## 35. Projects and Notion (2026-09-13, 0.9.9 page, 1.0.0 native)

Matt: "we should bring back linking projects and have the local AI go through and examine them where
possible for context so we can also link notion boards to convert list items into notion tasks or say
'add a note for the notion task for <notion task title fuzzy match>' and reference the notion task in a
formatted link". His choices: projects are GitHub repos; Notion is "Sign in with Notion"; list items
become tasks by voice, by swipe and by sending a whole list.

**Projects** (`projects/projects.ts`, the note's cog → Project). Paste a GitHub link (and a token for a
private repo, kept on the phone). The page reads GitHub's API directly: the repo's description and
default branch, its tree, and up to eight files that say what it is, ranked README,
AGENTS.md, docs with "design" in the name, the manifest, other top-level docs, skipping vendored and
built folders. Up to 16,000 characters of that go to the formatter's model (or the smallest one on the
phone) with a prompt for a plain briefing under 250 words: what it is, its parts, the names and terms
that will come up, current work. With no model, or in a browser, the README's words (HTML, images,
badges and link targets stripped) stand in. The pack is kept under `glyph-github-projects` (not the
0.4.x `glyph-projects`, which holds entries of another shape) and linked per note in
`glyph-project-links`. `projectContextFor(noteId)` hands the pack to the formatting pipeline
as the request's `context`, so it sits in the snapshotted prefix; `projectContextVersion` counts in its
"changed since" hash.

**Notion, the server half** (`server/src/notion.rs`, glyph-api). A public integration's code has to be
swapped for a token with the client secret, which cannot ship in the app. `start` (state + PKCE-style
challenge) redirects to Notion's consent page; `callback` swaps the code and holds the tokens for ten
minutes, answering the browser with a one-line page in ink; `claim` hands them over once, only to a
verifier whose SHA-256 is the challenge, so the token never travels in a URL; `refresh` swaps a refresh
token. No bearer token on these routes: the public web build carries none, and the verifier and the
refresh token are the secrets. NOTION_CLIENT_ID and NOTION_CLIENT_SECRET come from `.env` and travel
to the box's root-owned environment file over the deploy's stdin (`scripts/deploy-server.mjs`); without
them the routes say sign-in is not set up.

**Notion, the phone half** (`src-tauri/src/notion.rs`, native generation 12). api.notion.com does not
answer a web page, so Rust keeps the account in `notion.json` under the app's data (written beside and
renamed over, 0600, removed by a reset) and makes the calls the page asks for, limited to the routes
Glyph uses (search, databases, data_sources, pages, blocks, users/me), refreshing once on a 401.

**Notion, on the page** (`core/notion.ts`, `settings/NotionPane.tsx`, `editor/NoteSettings.tsx`,
`notion/items.ts`, `editor/swipeItems.ts`, the recorder):

- Settings > Notion: signed in or not and to which workspace, Sign in / Sign out, and the boards shared.
  Signing in opens the browser; coming back to Glyph collects it by itself.
- A note's cog → Notion board picks where its tasks go (`glyph-notion-links`), and Send list to Notion
  makes every unsent item a task. An item is sent once: its words become `[words](task url)`, which the
  editor shows short, and ticked to-dos and items that are already links are skipped.
- Swiping a list item left in a linked note sends that one: the line follows the finger, a tile behind it
  fills toward the send point and turns ink when it counts.
- By voice while recording: "send that to Notion" (the last phrase, or the items just added to another
  note), "new task for AttackFM in Notion, …" (the item goes into AttackFM's list and to its board), and
  "add a note for the Notion task for …" (the task found by name across linked boards, fuzzy, and linked
  in the take). A sent phrase of the take keeps the shape its cues gave it and only gains the link
  (`applyLinks`).

## 36. "Leave a note for …" (2026-09-14)

Matt: "leave a note on the page for <title> that says <desc> and make it smart enough that if a list
item is present it will add to the list intelligently".

- **The command** (`capture/route.ts`, kind `leave`). Said at the start of a phrase: leave, add, put,
  write, drop, jot or stick; a note, line, comment, reminder or memo; on, in, to or for; optionally "the
  page for" or "the note called"; then the note's name; then what introduces the note ("that says",
  "saying", "that", a comma or a colon). "Leave a note for AttackFM." on its own waits, and the next
  phrase is the note, as "new item for" does. "Add a note for the Notion task for …" keeps its own
  reading. The name is matched to a note the same fuzzy way as every other route.
- **Where it goes** (`capture/listAppend.ts`, `leaveNote`). A note with a list takes it as an item of that
  list, in the list's style (a to-do list gets a to-do, a numbered list the next number). A note with
  several lists takes it in the one it fits: the list whose heading (or "Label:" line) and items share
  the most words with it, the heading counting double, the last list on a tie. A long thought (more than
  30 words or two sentences), or a note with no list, takes it as its own paragraph at the end. "That" and
  "to" before the words are dropped: "that says to fix the login" is the item "Fix the login".
- **Seen as it happens.** The chip reads "Note for AttackFM" while the name is being said, "Say the note
  for AttackFM" while it waits, and the landing preview shows the list's last lines with the new one
  arriving under them. A tip in a pause teaches it with one of your own titles. `?simulate=leave` in the
  browser says it both ways.

## 37. Plugins (2026-09-14)

Matt: "build plugin support and extract the notion stuff into a plugin that ships standard". Built in and
switchable (not installable from outside yet), with GitHub Projects the second standard plugin. The guide to
writing one is `docs/PLUGINS.md`.

- **Nothing in the app names a plugin.** The note's cog asks `plugins.noteLinks()` and `noteActions()`, the
  list swipe asks `itemAction(noteId)`, the recorder asks `voiceCommands()`, `itemTargets()` and `tips()`, the
  formatter asks `pluginContextFor(noteId)`, and Settings asks `usePlugins()`. A plugin switched off offers
  nothing, at once. Its data stays for when it's back on.
- **The manifest is enforced.** A plugin reaches the phone only through its host, which refuses native commands,
  storage keys and permissions the manifest didn't declare. The registry refuses a plugin whose voice commands
  lack `voice`, or whose note actions lack `notes`. Settings › Plugins lists each permission with its reason and
  the hosts it talks to.
- **What moved.**
  - `core/notion.ts` → `plugins/notion/client.ts`, now through the host.
  - `settings/NotionPane.tsx` → `plugins/notion/`.
  - The board picker and Send list (from NoteSettings and NoteScreen) → `plugins/notion/`.
  - The Notion voice commands (from route.ts and CaptureScreen) → `plugins/notion/voice.ts`.
  - `projects/*` and the project picker → `plugins/projects/`, which gains a Settings page (repos read, Forget,
    the token).
  - `notion/items.ts` → `core/itemLinks.ts`, since linking list items is generic.
  - The item command's `notion` flag is a generic `target` word that a plugin offers.
  - The swipe tile's word comes from the action.
  - `reset.ts` takes plugin keys from the manifests.
  - The parked Developer › Projects switch is gone.
- **Settings.** Each switched-on plugin with a page gets a row (Notion, Projects) in its own group, then
  Plugins, reading "2 of 2 on".
- **Kept stable.** Notion still needs native generation 12 and the same four commands. The storage keys are
  unchanged, so boards, projects and sign-ins survive the update. With one context-giving plugin its version
  passes through untouched, so no note is formatted again because of the move.

## 38. "Glyph", then the command, then yes (2026-09-14)

Matt said "add a note to hello trade" while recording, and got a new note titled "To the hello trade". His
request: "have it listen for keywords and not do anything until it hears the keyword and confirms the action like
adding a list item to the hello trade note". Two faults caused it. Commands only matched a handful of exact
phrasings ("add buy milk to …" and "add a list item to …" matched none). And a pause mid-command split it into
two phrases that were each plain words.

- **Nothing is a command until "Glyph"** (`capture/command.ts` `findKeyword`). This covers the spellings the small
  model writes for it (glif, gliff, glyf), with "hey" or "OK" in front, and never matches "hieroglyphs" or
  "cliff". Words before the keyword stay in the note. Words after it, across as many phrases as it takes, are the
  command, shown in the chip ("Glyph: add a list item to…") and never written into the note.
- **Read loosely, since the keyword already marks a command** (`planCommand`). Everything route.ts knew, plus
  "add/put/stick X to/in/on Y". Every split point is tried, and the one whose name best matches a note wins.
  "A list item", "a task" or "a note that says" in front says what kind of thing it is. A command that names a
  note but not what goes in it waits for the next phrases (the chip reads "Say the item for HelloTrade").
- **Then it asks.** A card where the chip was: "ADD TO HELLOTRADE", the lines exactly as they will land (the
  preview and the result are both `placeWords`), "In its list" or "As a new paragraph", then Cancel and Add. It
  also takes "yes" or "no" said aloud (`reply`; short phrases only, so "No problem with the invoice" is a
  sentence). Talking on leaves the card up and the words go into the note. Twenty seconds unanswered means not
  done. Plugins' commands ask too: `VoiceCommand.describe` gives the card its words, e.g. "Send “Book the cabin”
  to Notion".
- **The keyword said as a word** ("Glyph is going to need a plugin store"). With no command within 4.5 s, what
  was said goes back into the note as it was. A note about Glyph shouldn't lose its words to a false start.
- **The recording stays open.** Stop-when-quiet waits while a command is being said or asked about.
- **The better words leave commands out.** The refine pass re-transcribes the whole take, so it was putting routed
  command words back into notes. A job now carries `skip` (the command stretches) and `keywordAt` (phrases cut at
  "Glyph"), and `withoutCommands` drops and cuts the better phrases by overlap.
- **Settings › Recording › Commands start with “Glyph”**, on by default. Off, a phrase that reads as a command
  still counts without the keyword, and still asks. The tips in a pause teach the keyword form.

## 39. Tables, said a piece at a time (2026-09-14)

Matt: "add a feature for creating markdown tables ... if we say something like 'add a table to the attackfm bugbash
note' it should ask 'and what will the column labels be?' ... to guide the user more".

- **Asking for one** (`capture/command.ts`, plan kind `table`). After "Glyph": add, make, create or start a table.
  Name a note ("to the AttackFM bugbash note") or none, meaning the note being recorded. "…with columns bug, owner
  and status" skips the first question. "A table of contents" isn't a request.
- **The conversation** (CaptureScreen `TableCard`). A card where the chip is asks one thing at a time: "What will
  the column labels be?", then "What goes in the first row?", then "Next row? Or say “done”". The table grows
  in the card as it's answered, and the words being heard show under the question. Everything said while it
  asks is the table's, never the note's (and the better-words pass leaves it out). "Cancel" or "never mind"
  drops it, so does 45 s of nothing, and "That's all" on the card finishes it like "done".
- **Cells** (`capture/table.ts`). A row is said the way a list is: commas, with "and" before the last one
  ("bug, owner and status"), or "and" alone. "Column one, …" prefixes are dropped. A short row is padded, and a
  long one keeps its extra words in the last cell rather than growing a column. A pipe in a cell is escaped.
- **Then it asks, like every command.** The finished table is previewed ("ADD THIS TABLE TO ATTACKFM", "2 rows,
  at the end of the note") and a yes or a tap adds it as its own block at the end of that note. A table for
  the note being recorded follows the take's words.
- **Drawn as a table** (`editor/tables.ts`). A GFM table the caret isn't in is drawn as a real one: header,
  hairline grid, words never broken mid-word, scrolling sideways when wider than the screen. Tapping it puts
  the caret at its start and shows the pipes to edit; moving out draws it again. It's a state field, because
  block decorations can't come from a view plugin, and focus is tracked in a field of its own. The Formatted
  view uses the same editor, so tables are drawn there too (read-only, always drawn). The formatter keeps table
  blocks verbatim (`format/tables.ts`).
- `?simulate=table` answers the questions and says yes; `?simulate=tableask` stops at the yes.

## 40. The review after a recording (2026-09-14, 1.1.0, native generation 13)

Matt: "Show the AI reasoning dissecting and parsing the note after we hit stop, use slower more detailed models to
check if the fast model got stuff right and work with the user to resolve and commit". He chose a review screen
right after Stop, all four checks (words, structure, commands, names), and the model's raw thinking over a
narrated checklist, knowing that needed an APK.

- **Stop still saves first.** The note is written exactly as before, and only then does the recorder hand over
  (`ReviewHandoff`): the note, the better-words job the queue would have run, every phrase the fast model heard
  (commands included), what each "Glyph" command did or was declined ("Did: add “Fix the seek bar” to
  HelloTrade’s list", "Offered to …; the person said no"), and the other notes commands changed. Leaving at any
  point loses nothing, and whatever would have run anyway (better words, formatting) is queued as before.
- **Listening again** (`capture/refine.ts` `listenAgain`). The larger speech model runs over this take now,
  with progress, instead of later in the queue. The queue and the formatter are held while the review is on
  screen, since they want the same cores.
- **Comparing words** (`review/diff.ts`). A word-level LCS of the fast transcript against the careful one,
  grouped into runs with context. Case and punctuation are ignored, but "hello trade" and "HelloTrade" still
  differ.
- **Thinking it through** (`review/prompt.ts`, `useReview.ts`). The formatting model, or the largest Qwen on the
  phone, since Gemma doesn't reason, with reasoning ON. It gets both transcripts, the disagreements, the
  commands, the note titles, any note a command changed, any plugin context, and the note last. Its thinking
  streams raw into a monospaced pane that follows the newest line.
  - The native layer used to switch thinking off with an empty thought. `ai_generate` now takes `think` and
    `think_budget`, and reports `thinking` on progress and output. Formatting passes send neither and are
    unchanged.
  - The budget matters: on the Mac the 4B reasoned past 2,400 tokens without answering. Past its budget (700
    for the 4B, 600 for the 2B, 500 for the 9B) the engine closes the thought for it in its own voice ("I have
    thought about this enough; …</think>") and the answer is sampled after. Measured: 787 tokens, 115 s on the
    Mac CPU, one correct finding.
  - `llm::tests::prints_a_review_with_its_thinking` runs the real prompt.
- **Findings, earned** (`review/findings.ts`). The answer is a JSON array, read leniently (fences, chatter,
  trailing commas). A finding is kept only if its check is known, its note exists, and its `find` really is in
  that note (exactly, or with whitespace and case forgiven). A model that invents a problem can't invent a fix.
  Changes are "replace" or "add a line" (a list item joins its list). A replace changes the LAST occurrence,
  since the words just said are the newest.
- **Deciding.** Each finding is a card: the check, which note, what and why, the text struck through and the new
  text. "Use this" is the default, a tap makes it "Keep mine", and Edit changes the new text. "Commit N"
  applies the accepted ones to every note they name. "Keep as is", Skip or Back leave the note alone.
  Without a language model the careful model's word changes are offered on their own.
- **Gated.** `reviewAvailable()` needs native generation 13, the Recording setting "Review after recording" (on
  by default), and an unlocked phone. On an older binary Stop behaves exactly as before.
- `?simulate=review&review` in a browser runs the whole flow with scripted models.

## 41. Test results, in Developer mode (2026-09-14)

Matt: "When developer mode is on add a test suite reporting page like we have on attack fm". It follows AttackFM's
page: a report generated where the app is built, compiled into the page, and read in Settings.

- **The report** (`scripts/test-report.mjs`, written to `src/app/diag/testReport.generated.json`). It runs every
  suite to the end, whatever the others did:
  - the page's Vitest (JSON reporter with task locations)
  - the app's Rust: `cargo test --lib` in src-tauri, which leaves the real-model tests ignored
  - glyph-api's Rust
  Parsing is pure (`scripts/testReport/parse.mjs`, tested with the page), and ANSI is stripped and failures are
  clamped. A suite that ran no tests is an error, never a pass. `--only=` and `--skip=` keep the other suites'
  last results, marked "not run".
- **Matched by code, not by commit.** Glyph ships far more often than it commits, so the report records a
  fingerprint of `src/`, both crates' `src/` and `scripts/` (`testReport/source.mjs`, the report itself
  excluded). `vite.config.ts` stamps the same fingerprint into the build as `__GLYPH_SOURCE__`. The page says
  "The same code this build was made from", or warns that the code changed after the tests ran.
- **Every release runs it.** `deploy-ota.mjs` runs the report before the web build and stops on a failing test
  or a suite that didn't run. `--skip-tests` ships anyway, and that build's page then says its report is from
  other code. This adds about 90 seconds per release.
- **The page** (`settings/TestResultsPane.tsx`, Developer mode only, under Developer):
  - A red or green verdict card, recomputed from the suites rather than trusting the report's `ok`, with Passed,
    Failed, Skipped and Not run (an alarm colour when they aren't zero).
  - Warnings: code changed, no fingerprint, suites that didn't run.
  - Where it came from: version, fingerprint pill, commit (+ changes), when it ran, the machine, the tool
    versions.
  - Find: search on every word in a test's name or file, and "Only failures".
  - One card per suite. Tests are grouped by file (a Rust test's module path stands in for its file), with
    failures first and open, and each failure's output under it.
- First run: 436 passed, 0 failed, 7 skipped (the real-model tests), in about 90 s.

## 42. The library: notes as Markdown files (2026-09-14, 1.3.0, native generation 15)

Matt: "a folder and sub folders full of purely markdown files with a small flat file things like sqlite or json
files for indexing so we can keep our whole library in these files … it should all render to valid markdown but
store metadata we can specially format such as linked notion tickets and to-do lists". He chose a folder he
picks, his own folders with titles as file names, Obsidian-compatible metadata, and a hidden `.glyph` folder.
The format is specified in `docs/LIBRARY.md`. This is phase 1: the library in the app's own storage, behind the
same commands.

- **The page didn't change.** `src-tauri/src/library/` implements the old `Store`'s calls (list, get, save,
  delete, pin, archive, recording, formatted, capture), and `NotesStore` now holds a `Library`. The page only
  gains `Note.path`.
- **Files are the truth** (`library/mod.rs`). Every read of the list walks the folder first. A file whose
  modified time and size match its index row is skipped, a changed one is read again, and a row without a file
  is dropped. Opening a note re-reads its file and re-scans if the file is gone or its body changed, so an edit
  in another app shows up. `.glyph/index.sqlite` (`PRAGMA user_version` 1) is a cache that a version change
  simply rebuilds.
- **Front matter** (`library/frontmatter.rs`) is edited by line, never parsed into a map and re-serialised.
  Unknown keys, comments, lists and quoting stay exactly as written, and a key is only touched when its value
  changes. Values Glyph writes are quoted when YAML would misread them.
- **Names** (`library/names.rs`). A title is the first line of words with its Markdown gone: heading and quote
  marks, list and task markers, link addresses (their words stay), pictures, emphasis and bare URLs, and a
  trailing item mark like `[notion](…)`. The first move on the emulator named a file
  "- Buy milk(httpswww…).md"; now it's "Buy milk on the way home….md". Characters a file system refuses are
  dropped, names are cut at 80 characters at a word, and clashes get " 2". Saving under a changed title renames
  the file, and the id in front matter keeps it the same note.
- **A pin is not an edit.** Pin and archive rewrite only front matter, then set the file's modified time back
  (`File::set_modified`), so the list order doesn't jump.
- **Copies.** A file carrying an id that another existing file already has gets its own id, so a copy made in a
  file manager is a second note rather than a fight over one row.
- **Drafts.** The page saves a new note the moment + is tapped, so a backgrounded webview can't lose it. With
  files, every note opened and left became "Untitled N.md". Only words are worth keeping that way, so a blank
  new note is now a draft in native memory, and the first save with words writes its file. A note this run
  started as a draft goes back to being one if all its words are removed and nothing else was set. An earlier try deleted empty notes from the page on the way back, but the editor's last save
  isn't awaited, so it could race a note just typed in. Deciding inside the library, under its lock, can't.
- **Moving in** (`commands.rs` `open_library`). The first launch writes every old note to `Inbox/` with its
  front matter, sidecar and original modified time. Notes with no words and nothing set are skipped, since the
  old app's save-on-open left them behind. `library.json` records the move, and only then are
  `glyph.sqlite{,-wal,-shm}` renamed `.moved`. A move cut short is finished next launch, because a note already
  in the library is never written again.
- **`Vault`** (`library/vault.rs`) is the only thing that touches files: list, read, atomic write (a `.part`
  beside the file, renamed), rename, remove, stat, keep modified time. Paths are relative with forward slashes,
  and `..`, empty segments and absolute paths are refused. Phase 2's folder picker will be a second `Vault` over
  the Storage Access Framework.
- **Checked on the emulator** with a backup of its old database, moved in twice (before and after the skip). 9 notes moved in as 8 files plus
  one skipped empty note, with 6 sidecars. The pinned group, the order and "1 HR AGO" were unchanged. An edit
  renamed its file and kept its id. A new note left empty wrote nothing, a typed one wrote
  `Inbox/Draft check note.md`, and clearing it removed the file.
- Tests: `library::tests` (11), `library::frontmatter` (5), `library::names` (4).

## 43. Workspaces (2026-09-14)

Matt: "add workspaces so we can sort notes by a given workspace."

- **A workspace is a name, and a note is in at most one.** Kept on the page under `glyph-workspaces` (core/workspaces.ts), so it ships over the air: the note store is Rust's SQLite, and a column there is a native change. Nothing is shown while there are none, so a list that never uses them looks as it always did.
- **The list.** Once one exists, a row of outlined names sits under the title (notes/WorkspaceBar.tsx): All, then each workspace, then + for another. The chosen one is solid ink, the list shows only its notes, and the choice is remembered, so the app opens where it was left. Tapping the chosen name again opens its sheet (notes/WorkspaceSheet.tsx): rename, or remove. Removing unfiles its notes and deletes nothing. The archive is never filtered: it is the place to find anything.
- **The note's cog.** A Workspace row under Pin and Archive says where the note is; its page (editor/WorkspacePicker.tsx) lists the workspaces with the note's own ticked, a name for a new one that files the note there as it is made, and a way out of the one it is in. The first workspace is made here as often as on the list.
- **A note made while a workspace is chosen is filed there**, typed or spoken (App.tsx): the list the person is looking at is where the new note should appear. A spoken note that is already filed stays where it is; in memo mode the take goes on the last spoken note, which may live elsewhere.
- Deleting a note forgets its filing (notes/useNoteActions.ts), and so, now, its kept summaries and gist. Reset clears the key.

## 44. A ticked box when Notion says done (2026-09-14)

Matt: "Notion items that are done should automatically update the checked status of the checkbox for the item they're listed in."

- **editor/doneSync.ts** watches the mark details the pills draw (core/markDetails.ts) and, when a to-do line ends with a mark whose task reads as done, changes its `[ ]` to `[x]`. An edit to the note, saved like typing, and not in the undo history: undoing a keystroke should not untick a task that Notion says is finished.
- **Only that way round, once per change of the task.** The tick is answered to the task's last-edited time; a box unticked by hand stays unticked until the task itself changes again, so the note never fights the person holding it. A task in Notion's trash does not tick.
- Nothing new is read: the pills' own reads (editor/links.ts) are what arrive, for the marks in view while the note is open, every minute and on return.


## 45. Working through the Glyph Tasks board (2026-09-14)

Matt: "Take a look at the tasks in the Glyph task management board I've created from within Glyph, work through them and let me know as you do so I can ensure they're tracking in app correctly. When an item is linked to notion it should show a few key details". Each card was moved to In progress when started and Done when verified, with a note saying what changed and whether it needs an APK, so the pills in his notes show the board changing. The first update banner card was closed as already done by the white foil card (§29b), and duplicate cards were closed with their twin.

### 45a. What a Notion task is doing, in the note

- **Details are read back** (`core/markDetails.ts`, `plugins/notion/details.ts`). The editor asks by a mark's name and address, and the plugin that owns the name answers through a provider registered with its extension point (`GlyphPlugin.marks`). A switched-off plugin answers nothing.
  - The Notion provider reads `GET pages/{id}` through `notion_request`, so no new route or login was needed.
  - The status stage comes from the board's own status groups (`GET databases/{id}`, once per board), so "Shipped" is done wherever the board says so. A name guess is the fallback.
  - The pill's facts are a priority-like select and a due-like date ("Overdue" until done).
  - Two reads at a time; fresh for 45 seconds.
  - The last 300 answers are kept (`glyph-notion-tasks`), so an offline note still shows the last status.
  - Signing out forgets them.
- **When it reads.** On opening a note, on coming back to the front, and every minute while a note is open, for the linked lines in view (`editor/links.ts`).
- **First as one pill**, then reworked on Matt's next note: "Not all notion links are being auto formatted to have the full pill showing details … might need multiple pills … maybe consider a card."
- **A row of pills under every linked line** (`editor/linkedRows.ts`).
  - Which lines: an item ending in a mark, an old-style `[words](notion link)` item, or a Notion link in a sentence (`MarkDetailsProvider.reads`).
  - What it shows: the service's name (solid), the stage ring and status, and one pill per fact.
  - It hangs at the item's own indent (`--hang`). The mark at the end of the line draws nothing while the row carries it; on the caret's line it is written out in full as before.
  - Block widgets must come from state, so the rows are a StateField over the document, rebuilt when the document changes, details arrive (`detailsArrived`), or a menu opens.

### 45b. The menu that splits the note open

Matt: "tap on the notion pills to show a few options like opening the ticket in notion or un linking or updating etc. Make these context menus split text in place … splitting the page right where it needs to go and make the options typography and iconography heavy so they fit the theme on all context menus."

- **A tap on a row opens a block widget under it** (`editor/MarkMenu.tsx`, a React root inside the widget via `markMenuMount.tsx`).
  - The lines below move apart and the gap is paper-2 across the width, with its edges shaded like a cut. It grows open (`grid-template-rows` 0fr to 1fr).
  - Contents: the stage and status, the title set large, every property in two columns, and when it changed and was read.
  - Then full-width rows, each a ringed Lucide icon beside a word at xl semibold:
    - Open in Notion.
    - Mark done in Notion / Reopen: the board's first done or to-do status, or its Done checkbox.
    - Use these words as its title, when the item's words differ from the task's title.
    - Refresh.
    - Unlink: the mark or link comes off the line, and the words stay.
  - Menu actions report through the note's own sentence line (`NoteEditing.say`).
- **It closes** on a touch outside, the back gesture, another tap on the row, or an action that changes the line.
- **The press-and-hold menu took the same hand** (`editor/ContextMenu.tsx`): an icon over each word in bold, in a rounded band. It still floats above the selection, since splitting the page would move the text being selected.
- The floating card that briefly did this job (MarkCard) is gone.

### 45c. The note page, the keyboard, and the status bar

- **The tape scrolls with the note** (three cards). In the Write view, the tape row and the editor are one scrolling `.page`, and the header stays put. The editor grows with its words (`Editor` `grow`: height auto, and the scroller doesn't scroll or hold its overscroll, one class more specific than glyphTheme). The Formatted and transcript views keep their own scrolling under a fixed tape.
- **The keyboard covered the page** (two cards). Measured on the emulator: on Android 15+ edge-to-edge, `adjustResize` no longer shrinks the window, so a tapped line near the bottom stayed under the keyboard even while typing.
  - `MainActivity.fitAboveKeyboard` pads the WebView's parent frame by the IME inset, so the page sees an ordinary resize.
  - The listener sits on the frame, never the WebView. Set on the WebView, it replaced Chromium's own listener, `env(safe-area-inset-top)` went to 0, and the header slid under the clock.
  - The editor keeps the caret in view on any window or visual viewport resize.
  - Native generation 15; the page half works without it.
- **The status bar.** A fixed scrim of paper colour under the status bar fades out just below it (`app-statusScrim`, zero height where there is no bar). `GlyphHost.setLightChrome` makes the bar icons follow Glyph's Light/Dark setting rather than the phone's (preferences.ts calls it, and again when System follows a change). Native generation 15.
- **Scroll fades** (two cards: "gradient blur and fade … dont show when on top and bottom of scroll").
  - `art/ScrollFades.tsx` puts two fixed bands over a scroller's edges, each a 3 px backdrop blur masked by a gradient under a veil of paper.
  - Visibility is an attribute set from a passive scroll listener, so scrolling renders nothing.
  - Used on the note page (top and bottom) and the home list (top; the dock already fades the bottom).

### 45d. Colour, voice and touch

- **Seeded cassette colours** (`tapes/tapeColour.ts`). An FNV-1a hash of the note's id picks one of eight shells (tomato, tangerine, mustard, sage, teal, cobalt, violet, rose) and nudges its hue by up to six degrees. All share one oklch lightness and chroma, so every shell reads on black paper and white. Only the shell, print and wound tape take the colour; the label stays paper and ink. The id is for life (front matter), so a note keeps its colour through renames and on every phone.
- **The rings follow the voice** (`capture/voiceLevel.ts`, `SideKeyWaves.tsx`). The recorder publishes the microphone level, and `paceRings` sends rings out of the side key's glow.
  - In silence, one faint ring every 2.7 s.
  - Talking, one every 220 to 580 ms, each wider, brighter, thicker and quicker the louder the voice.
  - Rings are created and animated directly with Web Animations, capped at nine, with no React renders. Reduced motion keeps three still rings.
- **Feeling a detent coming** (`core/detentFeel.ts`). While a swipe closes on a detent (the list row's Pin/Archive/Delete, and a list item's swipe to Notion), light ticks come faster as it nears: none in the first third, then 240 ms apart down to 40 ms. Then comes the firm click of arriving, and nothing while backing off. The item swipe also gained the arrive and back-off clicks it never had.

### 45e. "Glyph", while Glyph is open

Matt: "While Glyph is open I should be able to say the AIs wake word in order to make it start transcribing and updating notes as requested." This reverses the pause of 2026-09-13 for the in-app case only; there is still no background hotword.

- **When it listens** (`capture/useWakeWord.ts`): the list or a note is on screen, no settings or guide is open, the keyword and the new "Listen for “Glyph” while it's open" switch are both on (on by default), and the voice model is already on the phone (it never starts a download).
- **What it costs** (`capture/wakeWord.ts`).
  - In quiet, only the level is watched and the last 1.2 s are held.
  - 400 ms of voice starts a Whisper session on the held audio, and each partial is looked through with `findKeyword`.
  - Speech that ends (1.2 s quiet) or runs past 7 s without the keyword is cancelled, samples and all.
  - Everything stays on the phone. Android shows its microphone dot while Glyph listens.
- **The hand-over.** Hearing the keyword cancels the session and leaves the open microphone and everything since the speech began (`takeWakeHandoff`). The recorder opens (`woke`, aimed at the open note if there is one), rebinds that microphone to its own handlers, and transcribes the held audio first. What came before the keyword in its first phrase is dropped, since that talk wasn't for Glyph. The command and its "shall I?" follow as always.
- **One Whisper session at a time.** A listener stopped while its session was still starting would cancel it on arrival, possibly after the recorder had started its own. The recorder therefore waits for `wakeSettled()` before `capture_start`, and whoever stops or wakes the listener owns cancelling a starting session.
- **The permission loop.** Asking for the microphone puts Android's permission activity over the app for an instant, which hides the page. The first build stopped on that hide and started again on return, round and round, and the emulator ended up with the microphone denied "don't ask again". Now a hide only lets the microphone go after 2.5 s, and a failed start isn't retried until the conditions change.
- **Checked on the emulator**: the listener holds the microphone on the list, an ordinary recording starts beside it, and it picks the microphone back up after Discard. The spoken hand-off needs a voice and was left for the phone. `wakeWord.test.ts` covers the pacing.

## 46. A note wears its links (2026-09-14)

Matt: "There should be some kind of indication if a note is linked to a given notion board or git
project." The only place that said so was the cog sheet.

- **`NoteLink.linked(noteId)`** (`plugins/types.ts`): a link names what the note is linked to
  ("Glyph Tasks", "attackfm/app") or null. The registry's `linksOf(noteId)` collects them from the
  plugins that are on, and `useNoteLinks` keeps a component current: the plugin host now announces
  every write to a plugin's storage (`onPluginStorage`), which is where links live.
- **`plugins/LinkMarks.tsx`**: the plugin's mark in a ring with the name beside it. On the note, a
  row under the tape that opens the cog sheet; on a list row, the marks alone after the time, the
  names in the accessible text. Nothing is drawn for an unlinked note or a plugin switched off.
- **Staging build** (`GLYPH_STAGING=1 npm run android:build …`, `gen/android/app/build.gradle.kts`):
  the same code as "Glyph Staging" under `com.mattssoftware.glyph.staging`, beside the real app with
  its own data and no update checks (`ota.rs` `STAGING`, `UpdateCheckWorker`), so a build can be
  walked through as a new person sees it. `src/channel/<production|staging|dev>/res` carries the one
  resource that differs, the launcher shortcut's target package. `GLYPH_CHANNEL=dev` is the third app,
  "Glyph Dev" (`com.mattssoftware.glyph.dev`), for `tauri android dev`: a debug build whose page comes
  live from the Mac's Vite server and hot-reloads as the code changes, for working on the phone with
  Matt in the room.

## 47. The first page: waves from the side key (2026-09-14)

Matt: "research the rough position of the button on all modern flagship phones, create that list in a database, and on the 'Hold. Talk. Done.' first page have waves emanating from that button spot, but don't do anything to prompt the user to press it yet. Change the text to target telling the user that you hold and talk and the app writes clean markdown using local LLMs that don't kill baby seals or pollute the ocean; we can use quirky fun branding here."

- **Where the key is** (guide/sideKeys.ts): a table of current Android flagships, each with the edge the side key is on, seen from the front, and how far down the phone's height its middle sits. Rough, read off the phones; makers mostly agree on the right edge a little above the middle, below the volume rocker, and differ in one thing: Google puts the power key above the rocker, high on the right, and Sony puts it dead centre with a shutter under it. A phone is known by the model in its user agent (`SM-F971U1`, `Pixel 10 Pro`, `CPH2649`), failing that by its maker (`deviceMaker`, `Build.MANUFACTURER`), failing that the common case. `onScreen` moves a point on the phone to the screen: the display starts a little way down and ends a little short of the foot. The same list lives in Matt's Notion as the database "Side keys on flagship phones", to edit as phones come and go; the app carries its own copy because the guide runs before anything is signed in.
- **The waves** (guide/SideKeyWaves.tsx): four hairline rings of ink, centred on the screen's edge at the key's height so only their inner half shows, widening one after another to a third of a screen and fading before they reach the words. Behind the page (a negative z-index in the guide's stacking context: above its paper, below its content), no touch, nothing pointing, no word "press": the key is there and the page knows it, and that is all it says. Under reduced motion two rings sit still and faint.
- **The words.** "Hold. Talk. Done." stays. Under it: hold the side key and talk, and Glyph writes it up as clean Markdown; the writing is done by small language models on the phone that never phone home, no cloud, no server farm boiling a lake, no baby seals harmed, no oceans polluted. The setup line that was there ("two things to set up") is gone; the pages that follow do the setting up.

## 48. Words from smoke: the Wisp component (2026-09-14)

Matt picked Wisp from the Apparition Type playground (letters bent by SVG turbulence that stills as
each one sets) and asked for it "added to our text component through a helper", "character by
character", able to "swap around entire words", for the guide's first page.

- **`art/wisp.ts`**, pure and tested: a text is words and gaps; a change from one text to another is
  the longest common run of words kept in place, the rest leaving and arriving (a word that moved
  leaves and comes back rather than sliding); letters arrive at a hand's cadence (uneven, a breath
  after a comma, longer after a full stop) and leave from the last letter, quicker.
- **`art/WispText.tsx`**: the component. Its letters are its own DOM under a requestAnimationFrame that
  runs only while something settles; each settling letter has its own filter from a pool capped at
  48 (two letters sharing one flickered), a wide filter region and sRGB interpolation, as the
  playground found. The first `text` types itself in (or is simply there with `still`); each later
  `text` is a word-level swap: out, then in. Reduced motion shows the text at rest and fades changes.
  A screen reader gets the whole text once; the letters are hidden from it.
- **`art/useWisp.ts`** `useWispCycle(texts, holdMs)`: a line that keeps changing, for the headline.
- **The blank list after Skip** (seen once on the emulator): `useNotes` now retries a failed first
  read and re-asks once when the phone's first answer is empty, and the guide's close refreshes the
  list.

## 49. The first page, again: a heads-up that there's AI in here (2026-09-14)

Matt: "redo the first slide, it should be a heads up page that we use AI but say that it all runs on local models on your phone then we're going to do three funny anti AI animations with simple SVG elements like 'no dying baby seals' 'no datacenter water' then make one about it not helping prevent you from being stupid … that ones on you be funny and a bit adult sassy mean … a flashing no symbol then a seal getting bonked on the head with a club then like no symbol again then sludge nasty water turning toxic green with a gradient … heavy iconography and micro animations and color". This replaces §47's words and hero. The side key's rings (§47) stay behind the page.

- **Top of the page: the gags** (`guide/AntiAiStage.tsx`, words and order in `guide/antiAi.ts`). Beats go round:
  1. The no symbol slams in and flashes twice, with the gag's title under it.
  2. Its scene plays, with the punchline.

  Each beat is one React render. Every movement is a CSS animation over `--beat` (the beat's length), with parts turning about points in the drawing (`transform-box: view-box`). A beat only advances while the page is visible.
  - **"No dying baby seals."** A seal on an ice floe. A club on a blue sleeve winds up and lands at 34%: a BONK burst, X eyes, a lump, and stars going round. "Nobody got clubbed so you could write a grocery list."
  - **"No datacenter water."** A datacenter with blinking racks, steaming, pipes a lake dug into the ground. The lake's gradient stops turn from clear blue to sludge green, the fish goes belly up with X eyes, then stink lines and a skull. "No server farm drank a lake and spat it back out glowing."
  - **"No thinking for you, either."** A phone beams answers at a head. Its brain's wrinkles erase one by one, it shrinks to a pea and rattles, and the face goes cross-eyed and slack-jawed. "It won't stop you going soft in the head. That one's on you, sweetie."
  - Under the scene: a coloured badge per gag (blue, green, pink) with its Lucide icon, and a red ban flashing over it during the no beat.
  - With reduced motion, the three are listed still, each badge with its ban.
- **Then the heads-up.**
  - The headline "Heads up: there's AI in here." typed out of smoke (WispText, a size below the display face).
  - One sentence: every model runs on the phone, so nothing said goes to a cloud, a company, or anyone.
  - Four promises as coloured icon pills that pop in one after another, their icons wiggling now and then: Runs on your phone, No cloud, Works offline, Nothing sent anywhere.
- Checked at phone width in the browser by pausing each scene's animations at their moments: the bonk, the toxic lake, the shrunken brain. `antiAi.test.ts` holds the order and the words.

## 50. Wobbly waves, the microphone, and "Not yet, finish reading." (2026-09-14)

Matt, later the same day: "remove showing the glyph logo on the first page, make the pulsing waves wobbly and have them react to the phone's microphone, if the app is relaunched we can assume they hit the button on the side too early so reload with a warning about it being too soon but fit the ghostly theme without being cheesy, just be a bit sassy. Maybe just 'not yet, finish reading.'"

- **The logo** was the first page's hero art; it went with the page's redo into the AI heads-up (§47's Welcome was reworked on its own), so nothing more to remove.
- **The waves** (guide/SideKeyWaves.tsx, guide/waves.ts) are drawn on a canvas now, since they are no longer circles: three slow sines around each outline make it waver like something seen through water rather than shiver. At rest one faint ring every 0.95 s; a voice sends them out closer together, wider and brighter, with a bigger wobble, the level eased frame by frame so a word does not make a ring jump. Frames stop while the page is hidden. Under reduced motion two rings sit still.
- **The microphone** (guide/micLevel.ts) is a small listener of its own, loudness only, closed the moment the page leaves. The guide never asks for it: the first screen of the app should not open with a permission dialog, and the recorder asks when there is a reason to. So the rings listen where the microphone is already allowed and keep their beat everywhere else: a fresh install until its first recording, and the hot-reloading dev build, whose plain-http page has no microphone at all.
- **Too soon** (guide/tooSoon.ts, guide/TooSoon.tsx). The guide notes that it has started and which page it is on; both go when it is finished. A launch with the guide unfinished and left on a reading page (before the side-key page) is someone who held the key on page one: the app comes up on the guide again, one line typed out of smoke at the top of it, "Not yet, finish reading.", and a side-key launch does not record. The key held while the guide is open on a reading page does the same. From the side-key page on, a press is what the page asks for, and it records as before.

## 49. Marks from plugins, a secret in smoke, and the sample note

Matt: "add a default note with every kind of markdown formatting and table and image and everything we support,
add support for additional formatting characters through plugins and add spoiler as one which gives text an
extreme wisp effect when it's between two pipes || ||". Then: "we need a button up top to see all the formatting
symbols, it should split the UI open under the top bar with a wispy fade and then render in a row of formatting
controls we can scroll through horizontally".

- **A plugin can add an inline formatting** (`plugins/types.ts` `InlineFormat`): a node name, a delimiter run of
  one to three of a character Markdown doesn't already use, and a look. The editor's markdown
  (`editor/language.ts` `inlineFormat`) parses each switched-on plugin's formatting the way GFM parses `~~`, with
  the same flanking rules, into a node holding two marks and the words; the marks take the dimmed marker style
  every delimiter has, so nothing is hidden (§3.2). The look is drawn by two small view plugins, not the
  highlighter: `formatLooks.ts` puts a plugin's CSS on the words of a `style` look, and `wispFormat.ts` puts each
  letter of a `wisp` look in smoke. The registry checks the shape at start and refuses a delimiter like `**`.
- **The Spoiler plugin** (`plugins/spoiler/`) is one formatting and nothing else: `||the key is under the
  stone||`. Every letter between the pipes is bent, blurred and half-there, a dozen SVG filters shared round the
  letters and animated together at about thirty steps a second while any smoke is on screen, so the words can't
  be read; put the caret in them and they settle to plain text for editing, leave and they smoke over. Reduced
  motion keeps the smoke still, and still hiding. A read-only note never clears. The letters are plain inline
  marks carrying a filter, as the recorder's arriving words are (§48), so kerning and wrapping don't change.
- **Styles, from the press-and-hold menu** (`editor/ContextMenu.tsx`): a bar of symbols split open under the top
  bar came first and was taken out (Matt: "it doesn't look good as is, maybe it needs to be something we do by
  pressing and holding on text"). Holding on text opens the note's menu, and its Style word turns the menu over to
  the formatting in the menu's own hand, icon over word: the marks that wrap the selection (Bold, Italic, Struck,
  Code, then each switched-on plugin's, so Spoiler sits after them), the forms a line takes (Heading, Quote, List,
  Numbered, To-do), and the inserts (Link, Table, Rule; a picture stays Add image on the first page), in one band
  that scrolls sideways with a little room between the three kinds (three stacked bands "looks a bit strange"; a heavier rule read as "two pixels thick"). A long press on empty paper places the caret and opens the menu there. A style
  pressed wraps or unwraps through `editor/format.ts`, stays on the menu lit in reverse while it applies, so a word
  can take two in one go; an insert closes the menu. The styles come in out of smoke along each band; Back returns.
- **The sample note** (`core/sampleNote.ts`, `core/seed.ts`): one note with one of everything, headings to
  spoiler, a table, a fenced block, a rule, and a picture drawn on the spot (an ink cassette letting off smoke,
  rendered through a canvas into the library's pictures like any pasted one). A fresh library gets it once, a
  few seconds after the first read comes back empty; a library with notes is marked done and left alone, so an
  update drops nothing on anyone. Settings > About > Add the sample note makes another on request. The test
  parses the note and checks every node the editor knows is in it.
- **The marks page** (`guide/Guide.tsx` `Markdown`, `guide/phrases.ts`): the guide's "Talk in markdown" page became
  a rundown (Matt: "a quick rundown of markdown, our special symbols, and how to trigger each with voice"). Three
  lists: every spoken cue with the mark it writes beside the words to say and an example written by the real rules
  (`symbol` on each `PhraseGroup`, pinned by guide.test.ts to appear in its example); the marks that are typed only
  (`TYPED`); and the switched-on plugins' own marks, with the spoken cue where the plugin names one (`InlineFormat.cue`,
  the Spoiler's "spoiler … end spoiler"). The sample note's picture is Jocelyn Morales's smoke from Unsplash
  (docs/THIRD_PARTY.md); the drawn cassette was "quite ugly".
- **Six more marks** (`plugins/marks/index.tsx`), each its own plugin of one formatting so any can be switched off,
  made through one `markPlugin` helper (Matt: "i like all of these, add them each"): `==highlight==` (an ink wash),
  `%%aside%%` (smaller, muted, leaning), `??unsure??` (a dotted line under a doubt), `@@redact@@` (a solid bar,
  lifted while the caret is in it: `FormatLook` grew `clearAtCaret`, and `formatLooks.ts` follows the selection
  when any look lifts), `^^shout^^` (spaced small caps), `++added++` (a line under, the pair of `~~struck~~`). Each
  names its spoken cue and a line for the guide (`InlineFormat.about`); the sample note shows all six.
- **The home page from smoke** (`notes/NotesList.tsx`, `art/WispText.tsx` `delay`): "Notes" types in at a hand's
  pace and the first eight titles follow, quick and each a beat after the last (Matt: "offset them slightly so each
  animation looks special but doesn't take all day"); rows past the eighth are simply there, since the cost is a
  filter per settling letter. `WispText` gained a `delay` for its first text only; the row title's clip box has
  padding inside its margin so a bending letter isn't cut at the line.


## Memo mode sorts: the scratch page (2026-09-15)

Matt: "when I tell it to add a note to a list by a given title I want it to add to that list, but it just gets left on whichever note was last open. Change memo mode to write to a scratch file that's not real until the memo is done, then the AI can figure out how to sort." He chose: show the sorting and commit it; a blank scratch page while talking; without a model, the rules file the commands they know and the rest becomes a new note.

- **The scratch** (`capture/scratch.ts`): with Memo mode on and the recorder not aimed at a note, the take is written to the page's own storage a second at a time, not to a note, and the recorder shows a blank page headed "Memo · sorted when you're done". The recording is kept under the scratch's id. A scratch left by a take that never finished, a memo ended over the lock screen, or one left with Back waits on the list as "A memo is waiting to be sorted".
- **Sorting** (`sort/`): the reasoning model reads the memo beside the person's note titles (`sort/prompt.ts`) and answers with placements, each a note, what to add, and the memo's words it came from. Every placement must name a real note and quote the memo exactly (`sort/plan.ts` `readPlacements`), and the rules (`rulePlacements`, the recorder's own `planCommand`) add any plain "add X to Y" the model missed, so an explicit command is never lost. Without a model, only the rules sort.
- **The screen** (`sort/SortScreen.tsx`, the review's styles): each placement with Use this or Skip, and under them the new note that what's left becomes (`leftover`). Commit files the kept placements through `placeWords` and saves the rest as a new note carrying the recording; "Keep as one note" skips them all. Nothing is written before Commit.

## Memo mode picks a note first (2026-09-18)

Matt: "I want to rework how the local AI works to make things a bit easier to flow. I want memo mode to have the
first step selecting a note - ask for the title of the note and show a few recent options and get a partial match -
take a keyword as 'select note <note>' or 'use note <note>' or other variations. Then after a note is selected we can
use words like 'add task' as a trigger word, then the screen should say 'adding task… what task should we add?' and
we speak the task."

This reverses "Memo mode sorts: the scratch page" above. A memo used to be dictated onto a blank page and sorted
into notes by a model when it ended; now it opens by asking which note, and everything after that has somewhere to
go as it is said. The scratch page and the sort (`capture/scratch.ts`, `sort/`) are no longer written by the
recorder; a scratch left from before still shows on the home page and can be sorted.

- **Which note** (`capture/memoFlow.ts` `parseChoice`, `chooseNote`). The recorder's card asks "Which note?" and
  lists the five most recently edited notes, numbered. A note is named with a word in front of it - "use note
  groceries", "select the work note", "open weekend trip", "go to my groceries list" - or bare, or by its place,
  "the first one", "number two". The name is matched the way every spoken name is (`route.ts` `matchNote`), and
  more leniently after "use note", since the word said it was a name; a bare phrase that only half fits a title is
  taken as a miss, not a choice. As the name is said the note it seems to mean is drawn in ink in the list
  (`guessNote`). A name that fits nothing is said so ("No note called 'camping'. Which note?") and the card keeps
  asking; a name two notes fit about as well shows those two, so "the first one" settles it. "New note" starts a
  fresh one, and "new note called camping" starts one already titled. Over the lock screen the list is not shown
  and the note is not named, as before.
- **Then the note is the page.** Choosing puts the recorder on that note as its own Speak button would: its text
  above, the words said written onto its end, "Adding to 'Weekend trip'" in the top line. Plain talk is dictation,
  every cue works, and "Glyph, …" commands still reach other notes.
- **Trigger words** (`parseTrigger`), at the start of a phrase, ask for one thing: "add task" (or to-do, check box),
  "add item" (bullet, point, entry), "add a line" (note, paragraph, sentence). The card says "Adding a task - What
  task should we add?", the next phrase is the task, and it goes into the note's list (`listAppend.ts`
  `placeWords`, so it joins the list the note has, in its style, or starts a to-do list); a line asked for is its
  own paragraph, however short, where "leave a note for …" would have put a short one in the list. **No "shall I?"**: the
  trigger and the question were the asking, which is what makes it flow; "undo" or "scratch that" takes the last
  thing back. Said in one breath - "add a task: buy milk" - it goes straight in. "Add tasks" takes each phrase as
  one until "done" or a pause. "Never mind" drops the question. "Switch note" (or "switch to work") and "new
  note" leave what was said on the note it was said for and carry on elsewhere (`take.fork`).
- **A phrase that opens like a command is read by the rules first** (`opensLikeCommand`): "add eggs to groceries"
  names a note and asks as the keyword's commands do; "put the kettle on when we arrive" names nothing and stays
  words. The trigger words are Glyph's only where the recorder is in the flow, so a sentence in an ordinary
  recording is never read as one.
- **The take runs it** (`capture/take.ts`, the `flow` step and `FlowView`), so the voice suite tests it from
  scripts like everything else (`voice-tests/suite.json`, the "Memo flow" group, `prefs.memo`). The recorder draws
  it as a card in the place the table's questions and the "shall I?" card take (`FlowCard`), and the top line's
  "New note" becomes "Switch note".
- **Two things came right underneath.** A command that changed the note being recorded onto used to apply its
  change to the stored note, which already held the words a draft had saved, and set that as the base the next
  draft composed the words onto: the words appeared twice. The change now goes into the note as it was before this
  take, and the words follow it (`CaptureScreen.tsx` `updateNote`). And every write to a note - a command's
  change, the draft, the take carrying on elsewhere - now goes through one queue, since two close together read the
  same body and the second lost the first.

## The card is the note, small (2026-09-18)

Matt: "the preview for the formatting should use the same formatter that the actual note uses instead of custom
rolled small stuff like the checkboxes are weird for example." Then: "don't render boards in previews", "the
background and stuff should be transparent on the formatted preview", "the preview is rendering the whole note not
just a small preview".

- **The card holds the note's own editor** (`notes/NotePeek.tsx`): the same `Editor` the note opens in, read-only, in
  the formatted view, at 0.62 of the note's type (`--app-body` and the heading sizes redefined on the card, so the
  ratios hold), given the note after its title (`notes/peek.ts` `peekMarkdown`, fourteen lines at most) and clipped
  to about six lines in its own em, with a mask fade on the last line only when there is more below. The card is a
  button, so the editor takes no pointer events. It replaces the hand-drawn miniature (`notePeek`, still there for
  the sample note's tests), whose six-pixel box for a to-do was the "weird checkbox".
- **Peek mode** (`Editor`'s `peek`): the same formatter, but nothing that fetches, polls or acts - no link preview
  cards, no Mermaid, no board drawing, no tap-to-tick, no Notion reads for the marks (`shortLinks({ still })` draws
  them from what is known). A board's fence is left out of the markdown too: its items follow and are drawn as the
  list they are, the blank lines around the cut close to one, and an item's anchor is dropped - it is the name a
  board calls the item by, never part of what it says (BOARDS.md), and on a card it took a line of its own. The
  editor's paper and a code block's or a table header's fill are transparent on the card, and the page gutter is
  zero there, so a list's marker still hangs where the note hangs it (with the gutter simply zeroed on the line, the
  marker hung outside the card and was clipped: the `- [x]` was in the DOM and not on the screen).
- **An editor costs about 25-30 ms** on a Mac in the dev build (a bare CodeMirror view 8, the formatting extensions
  most of the rest), and the sidebar's tree has one card per note, so a card draws its editor only when within
  400px of the screen, one at a time in its own task so the page paints first, and drops it for a blank of its
  height once it has scrolled well away. Measured with a hundred previews in a scroller: five editors exist at any
  moment.

## Claude on the account: the MCP server (2026-09-18)

Matt: "make an MCP plugin for Claude so I can use Claude to remote control my account and add and update notes as
well as read them, be detailed and make sure it all works for every user". docs/MCP.md is the whole of it; the
choices, briefly:

- **It is a device, not a backdoor.** Synced notes are end-to-end encrypted, so anything that reads them holds the
  account key. The MCP server (`mcp/`) runs on the person's own computer, started by Claude, signs in with the
  password once, unwraps the key there with the same code the app runs (`core/sync/crypto.ts`, bundled in), and keeps
  what a signed-in phone keeps - the token, the key, a signing key of its own for renewing the session - in a file
  only they can read. The service sees nothing new. This was the question to settle first, and this is the answer.
- **The wire is the app's wire.** The same sealed payload under `note:<id>`, the same feed and cursor, the same `base`
  on every write, and a 409 handled the app's way: never written over, shown to Claude as the other device's words.
  The e2e test runs the app's own `syncNotes` as the phone against the built server, so the two cannot drift apart
  without a test going red.
- **Append is the app's append.** `append_to_note` uses `capture/listAppend.ts` `placeWords`, so a task Claude adds
  joins the note's list in the list's own style, as a spoken "add task" does.
- **One file to run.** esbuild bundles `mcp/main.ts` with everything under `src/` it reaches and the MCP SDK into
  `mcp/dist/glyph-mcp.mjs` for Node 20+, published beside the app (`deploy-ota.mjs --mcp`). A person needs Node and
  that file; `login`, then one line in Claude's config.
- **The app's modules it could not reuse as-is** are the two that read the page: `core/account/api.ts` reads
  `import.meta.env` at import, which Node has no such thing as, and `core/store.ts` reaches for Tauri; the client
  carries its own small `call()` and copies of `noteTitle` and `imageNames`, each pinned by a test.
- **Then hosted, at Matt's word** ("run the server on our node so that the user doesn't need to"), with the trade
  put to him first and chosen: the box holds a signed-in person's key **in memory only**, for the session, and the
  sign-in page says so. `mcp/hosted.ts` is the same tools behind OAuth 2.1 with the SDK's own handlers (dynamic
  registration, PKCE, refresh, revocation), sessions as maps in RAM, and MCP over plain HTTP, one request one
  answer. It runs beside glyph-api as `glyph-mcp.service` on the box's own Node 18, and glyph-api hands
  `/glyph/api/mcp` on to it (`server/src/mcp_proxy.rs`): the shared Caddyfile, edited by hand with care, stays as it
  is, and the discovery documents live under that path, where the client library looks once the root ones answer
  404 (which attack.fm's do). The whole flow is tested as Claude's own client library runs it.
- **The sign-in page is the app's** (Matt: "redo the plugin page with better iconography and typography usage"):
  Inter carried in the bundle as a data URL so the page needs nothing from anywhere, the ink scale from ink.css with
  dark as the same page printed in reverse, the Welcome shape on the Blank grid moving as it does in the app, and
  icons drawn on the app's 24 grid - a lock, a key, a door - one to each of the three things a person should know
  before typing a password. The one message it can show is ink with a mark beside it, under the password where the
  eye is, not below the buttons where a phone has scrolled past it. A state is a word and a shape, not a colour.
- **The Claude plugin's page, and the instructions drawer** (Matt: "add the instructions for the MCP to an
  instructions drawer we can open from the mcp page in the app"; then "I also don't see the Claude plugin", so it is
  one - `plugins/claude/`, standard, its switch showing or hiding the page and the page saying so): what it is, the
  address with a Copy, what the eight tools do in words, and where the key lives. Its rows open a card over the page
  (`plugins/claude/ClaudeGuide.tsx`): the steps one way at a time, hosted or on your own
  computer, each command in a block with a Copy, so a phone can hand them to a computer without retyping. It rises
  from the bottom on a phone and floats on a wide window, in the notes card's materials with a scrim under it, and
  closes on the X, the scrim, Escape or the back gesture. Drawn into the body: the settings panes move as they
  change, and a fixed card inside a moving thing moves with it. The words live in `claude/steps.ts`, with the
  addresses following the sync service the build talks to, so a staging build points Claude at its own server.
- **Plugins, redone** (Matt: "revamp and redo the plugins page"): a hero with the count and the one rule (a plugin
  off offers nothing anywhere and keeps what it kept), then a card per plugin that leads with the plugin as a thing -
  its icon in the hero's chip, its name, one line, its switch - then the way to its own page when it has one and is
  on, then what it may reach in one line ("Your notes · The internet (api.notion.com) · Voice commands") with the
  reasons a press away. The old page was a row per permission, which was most of it. "Nothing leaves the phone"
  holds the internet plugins off whatever their switch says, and the page says so at the top and on each card held.
- **Appearance in the kit's own clothes** (Matt: "I want the interface size and themes to use the same UI from
  glacier with the physical representation of the screen densities and colors on the app"): the theme is chosen from
  cards, each the page painted small in that theme's colours - AttackFM's ThemeSelector in shape, with the
  miniature redrawn as Glyph's note page: the bar with its two tabs, a heading, lines, a to-do with its box, two
  segments with the chosen one in the accent, the Speak pill (`settings/ThemeCards.tsx`). Light and Dark are the ink
  scale, chroma zero, with the accent left as a variable so the cards follow the swatch under them; the named themes
  take the kit's own preview, which is what the page becomes under one; System is split down the middle. Spacing is
  the kit's DensitySelector with Glyph's words for the steps. Interface size is five cards, each the same row of the
  app - icon, two lines, a switch - drawn at that step, in em from a font size that is the step, so what a step does
  is seen before it is chosen (`settings/ScaleCards.tsx`).

## 50. The tape only where there is audio

Matt: "Don't show the tape on notes that don't have any audio recorded; the notes with audio recordings added should
show the tape so we can add or remove audio there."

- **A note with no recording has no tape** (`tapes/NoteTape.tsx` renders nothing without one, and `editor/NoteScreen.tsx`
  drops the row). Talking into such a note is a ringed mic in the header, beside the robot and the cog, so it stays
  one tap away; the side key still clears the stage for a fresh capture as before.
- **A note with a recording has the tape**: the cassette and Play as before, and under Play two quiet words, Add
  (the recorder aimed at the note; the take is appended to the tape) and Remove.
- **Remove** forgets the recording's length and phrases (`set_note_recording` with null, native generation 6, so no
  new APK), and the tape goes at once with a five-second Undo that puts both back. The audio file itself stays on
  disk until the note is spoken into again or deleted, which is what makes Undo possible; the recorder now appends to
  a note's file only when the note still has a recording (`capture/CaptureScreen.tsx`), so a take after a Remove
  starts a fresh file instead of landing after the removed audio.


## The voice tutorial: every cue, then tips (2026-09-15; removed 2026-09-17)

Removed at Matt's word ("remove the voice tutorial for now its too long"). The cues it taught are in Settings > Help >
How to talk to Glyph (`guide/phrases.ts`), and the voice test suite (`voice-tests/`, `capture/voiceSuite.ts`) now
checks every one of them against recorded speech, which is what the tutorial's lessons had come to be used for. What
follows is how it was.

Matt asked for a tutorial "at any time for the commands you can say in the app" that marks off lesson by lesson, and
then, on what it was missing: "just learning the voice to markdown commands and tips and tricks".

- **Where it is.** Settings, About, Voice tutorial (`tutorial/TutorialScreen.tsx`). The microphone stays open for the
  whole tutorial through the recorder's own engine, and the session is cancelled, so nothing said is saved.
- **The lessons** (`tutorial/lessons.ts`, `lessonsFor`) come in five chapters. The basics: talk, title, sections, a
  spoken new paragraph, and a paragraph from a two-second pause. Lists: bullet points, a list in one breath, numbers,
  steps, to-dos, and a cue said on its own. Making it stand out: important, bold and italic, quotes, dividers, and one
  lesson for the plugins' spoken marks when any are switched on. Talking to Glyph: sending words to a note, answering
  yes or no, switching notes, and building a table, all against a pretend Practice list. Tips and tricks: pausing
  before a cue, words staying yours, the side key, saying "Glyph" in the app, Memo mode, and fixing a note after.
- **How a lesson passes.** A practice lesson checks what the recorder's rules write from what was really said
  (`renderNote`), or what `planCommand` and `reply` make of it, never the example's exact words. A tip is read and
  ticked with Got it. lessons.test.ts passes every lesson on its own example and checks plain talk passes only the
  first.
- **The screen.** A thin bar per lesson with gaps between chapters, the chapter and place above each lesson, and a
  summary at the end grouped by chapter where any lesson can be tapped to take again.

## A workspace chosen glides to the top

Matt: "When I click different workspaces the page should scroll back up smoothly, not just jump to the top."

The jump was the browser's: the new workspace's list is usually shorter, so the page couldn't stay as far down as it
was and snapped up in the same frame. `useGlideToTop` in `notes/NotesList.tsx` remembers where the page was (as it
scrolls, as a finger lands, and at every render), and when the chosen workspace changes it lends the shorter list
enough room at its foot to stay put for a frame, puts the page back, and scrolls to the top smoothly. The room goes
once the page reaches the top, where it is out of sight, or after three seconds whatever happened. The scrollend from
putting the page back is ignored, since taking the room away then would drop the page before it had moved. Reduced
motion goes to the top at once.


## The Notion opener is a drawer (2026-09-15)

Matt: "The notion opener should open in a drawerer instead of rendering in place." A tap on a linked line's row of
pills no longer splits the note open under the line. The same menu (`editor/MarkMenu.tsx`) rises from the bottom
in the note settings' sheet over the dimmed note: the task's stage, status and facts, its title set large, its
properties, then Open in Notion, Mark done or Reopen, Use these words as its title, Refresh and Unlink. A tap on
the dimmed note or the back gesture closes it, and an action that changes the note closes it. The open line is
still kept in the editor's state (`editor/linkedRows.ts`); a view plugin mounts the drawer over the page while it
is open and takes it down when it closes or the line loses its link.

## Two passes on speech: rules for marks, a model for commands (2026-09-15)

Matt: "it feels like the model for doing the agentic tasks should be different than the language parsing model, we
might need two different AI passes, I can't even pass the tutorial". No model read speech before this: Whisper
(base.en) wrote the words and hand-written rules found the cues and commands in them. Twelve synthesised voices
were run through base.en with the tutorial's phrases, and the transcripts through the lesson checks. The words were
mostly right; the rules missed three things.

- **"end bold" comes back "and bold".** It closed only after a pause at the opening cue. It now also closes when it
  ends the sentence (`capture/markdown.ts`); "bold thinking and bold action" is still prose. Plugin marks too.
- **"Glyph" comes back as anything.** "Gliff", "Gliv", "Glit", "Clith", and in half the voices a real word: "Life.",
  "Live,", "Head life,". The spellings are keywords now, and a sound-alike word counts at the very start of a phrase
  when what follows reads as a command (`findSoundAlike`), so "Life is short" stays words. "New notes" and "new
  node" start a note. "Glyph." leads the Whisper cue vocabulary (native: needs an APK); at the end of the line it
  read as its own sentence and broke carrying a sentence across a cut.
- **The command pass** (`capture/understand.ts`). When the rules can't read what was said after the keyword, the
  phone's language model reads it: after a 1.2 s pause, or at once when the rules named a note that isn't there.
  It answers one JSON object (add, switch, new, table or none); the note must be one of the person's, matched by
  title, and the recorder still asks before anything changes. The chip says "working it out" meanwhile. It runs only
  in a pause, with no words coming in, and is cancelled the moment speech resumes, then asked again at the next pause:
  it shares the phone's cores with Whisper, and the recording comes first. For the same reason it is not loaded ahead
  of time, so the first command of a launch waits for the load. Measured on the Mac on 24 commands as
  speech recognition writes them (`llm::tests::understands_spoken_commands`): Qwen3.5 4B 23 right at about 1.3 s,
  2B 20 at 0.5 s, 0.8B 6. Every miss of 4B and 2B was "none", which leaves the words in the note. 4B runs it when
  it is on the phone, else 2B. Marks are never sent to a model: they stay instant and the same every time.
- **The tutorial** uses both: its command lessons take the new spellings, and when the rules can't read the command
  it asks the same model against the practice note.

## Model downloads pick up where they were cut (2026-09-15)

Matt's Fold could not get any language model: "could not download Qwen3.5-4B-Q4_K_M.gguf", with attack.fm answering
404 and Hugging Face "peer closed connection without sending TLS close_notify". Two causes.

- **The attack.fm mirror has never had the language models.** Only the Whisper weights were uploaded to
  `/glyph/models/`, so every language model came from Hugging Face.
- **A cut connection threw the download away.** `whisper::model::download` read one response to the end or failed,
  and a failure deleted the `.part`, so 2.7 GB had to arrive over one unbroken connection. It now picks up where it
  stopped: the next request asks for the rest with a `Range`, the bytes written and hashed so far stay, and the hash
  carries on (Hugging Face's CDN answers a range with a 206 and the right `Content-Range`). A server that sends the
  whole file again is started over from the first byte, so the hash is always over the file in order. Eight tries
  from the last time bytes arrived, a little longer apart each time up to ten seconds; a mirror that never answers
  gets two; an HTTP error such as a 404 is never retried. `resume_tests` cut a local server's first answer a third
  of the way in, with and without range support. Native: it reaches phones with the next APK.

## The Glyph Tasks board, 2026-09-15 evening

Matt's list, worked through with each card moved on the board.

- **Wisp fade-in a third quicker.** Arc, jitter and stagger at 0.75 in `editor/wispArrivals.ts`; `art/WispText.tsx`
  the same, its letters' cadence times 4/3.
- **Backspaced letters fade where they were.** A ghost is a zero-width place at where the text went; it was drawn
  right-aligned to it, a letter left of the letter, and the next backspace carried it back another. It is left-aligned
  now and pinned (`pinGhosts`): its first position against the content is kept, and any later move is undone with a
  `translate`, measured after the DOM update and before paint. The delete fade is 140 ms, 85 ms in a run.
- **Header and More icons at the drawer's size.** The header's mic, robot and More draw at 22 px; the More sheet's
  rows (and plugin rows through `SheetIcon`) are a 22 px drawing in a 2.2 rem ring, as in `MarkMenu`.
- **The last letter of a linked item.** Only a pill opens the Notion drawer; the rest of the row under the item is
  the note's, and a tap there places the caret (`RowWidget.ignoreEvent`).
- **Done, both ways** (`editor/doneSync.ts`). A box ticked or unticked in the note runs the task's Mark done or
  Reopen; a task finished or reopened ticks or unticks the box. Each side answers a change of the other once, and a
  task that can't be written leaves the box as the person set it.
- **Notes reopen where they were left** (`editor/notePlace.ts`). The line at the top of the page and the offset into
  it, per note, the last 200. Restored once the note's words have arrived (they come after the editor), and written
  from the last scroll, since the page is gone by the time the note closes.
- **Pinch to zoom** (`editor/pinchZoom.ts`). Two fingers set `--note-zoom` on the note's page, which redefines the
  body and heading sizes there (a custom property is computed where it is defined, so the root's could not follow),
  from 0.7 to 2, kept for every note. The position under the fingers is held with `coordsAtPos` each frame.

## Voice memos, and the page set as it is spoken (2026-09-15)

Matt: "show actual stuff being written out and formatted as i talk. allow for voice memos to be left as a bullet
point or inline audio segment."

- **The live page is set, not marked up.** The recorder already writes into the note's own editor
  (`capture/LivePage.tsx`); it now shows it in the formatted view, so a heading is a heading and a bullet a bullet as
  it is said, with no marks around them. The note it saves has every mark, as before.
- **A voice memo keeps the sound instead of the words.** "Voice memo" said as its own phrase (`capture/voiceMemo.ts`)
  stops the words being written; what follows stays on the note's tape until "end memo" or a two-second breath, and a
  clip of it is written where the cue was: after "bullet point" it is a bullet, mid-sentence an inline segment. Done
  closes an open memo.
- **A clip is markdown** (`core/clips.ts`): `![voice 0:12](tape:12000-19500@k3f9x2)`, milliseconds into the note's
  recording, so a note is still a plain file. The times are written with the continued tape's length added, since a
  take is appended to the tape it already had.
- **And it says which tape it means.** A note's recording can be removed and another recorded, and the new file
  starts its own timeline, so times alone would point at whatever sound is there now. Every take names its tape - the
  one a continued note holds, or a fresh id - kept beside the note on the device (`tapeId`, `setTapeId`), because the
  audio is on the device too. Remove forgets it and Undo puts it back. A clip plays only while the note's tape still
  carries its id; otherwise it is the quiet mark. A mark with no id, from the first day of clips, plays while the note
  has any recording.
- **The editor plays it where it sits** (`editor/clips.ts`): the mark is replaced by a small player, and comes back
  on the line the caret is on, the bargain the formatted view makes with every mark. With no tape to play - a note
  read in a browser, a recording removed, a clip of a tape the note no longer has - it is a quiet dashed mark saying a
  memo was left here, and nothing to press. One `<audio>` per clip on first
  tap, over the recordings scheme, which serves byte ranges; one plays at a time; the end is watched as it plays.
- **The better words keep them.** A memo's stretch is skipped like a command's, so the larger model never writes its
  words, and `refine.withClips` puts each clip back among the refined phrases in the order they were spoken.

## The board, late on 2026-09-15

- **Backspacing is instant.** A single letter deleted by hand leaves no smoke (`editor/wispArrivals.ts`); it read as
  a stutter under the fingers. A word or selection taken at once still smokes, and so does a letter a rewrite takes
  back while you are talking, which is not typing.
- **The Notion drawer takes the keyboard down with it.** Opening it blurs the note, so the keyboard cannot stand over
  the drawer (`editor/linkedRows.ts`).
- **A bookmark in the header** (`editor/NoteScreen.tsx`, `editor/notePlace.ts`). With none it marks where you are;
  with one it takes you back; pressed again where it already is, it comes off. A note opens at its bookmark ahead of
  wherever it was last left, and the icon is filled while one is set.
- **Sheets have a handle you can pull** (`editor/sheetDrag.ts`). The grip follows the finger down and closes the
  sheet past a hundred pixels or on a flick, judged on how the pull ended rather than its average; a short pull
  springs back; upward it gives a little and returns. The grip alone is the grab, so the rows inside still scroll.
- **Voice memos with nowhere to go** (`sort/plan.ts`, `sort/useSort.ts`). When everything left of a sorted memo is
  clips - bullets and blank lines aside - the note becomes "Unsorted memos" and is filed in a workspace of that name,
  instead of an untitled note of nothing but players.

## Smoke at both ends, and under the clock

Matt: "replace the areas where it's just a black fade and blur to use the wisp fade effect, like the safe area fade
and the bottom page blur."

- **The foot.** `art/wispEdge.ts` gained a foot band: the same strip, blur and bend at a view's bottom edge, with its
  own noise and its own subregions placed by `placeFoot`, so it costs the band and not the page, and parked far below
  while a view has no foot. `useWispEdge(..., { foot: true })` turns it on; the note screen uses it, and the mask fades
  the last 30px (`--wisp-foot-fade`). `art/ScrollFades.tsx`, the blurred paper bands it replaces, is gone.
- **The clock.** On a view with no header the status bar now plays the part of one: the band's lip sits at its edge and
  the top mask reaches it (`--wisp-top-fade` = safe area + 29px), so a page dissolves in smoke as it passes the clock.
  `.app-statusScrim` is solid paper across the bar and stops there; the gradient tail below it is gone.

## Every mark, side by side

Matt: "create a guide page, it should show every formatting mode we have in a table and show you an example of how
it works." The guide has a sixth page (`guide/pages.ts` 'marks', `guide/MarksTable.tsx`): two columns, what you type
on the left with its marks showing, how the note reads it on the right, and under that the words to say while
recording where there are any. The rows are data (`guide/marks.ts`): the app's own marks by group (words, lines,
blocks), then the marks of every switched-on plugin, read from the registry, so a plugin switched off is never
promised and a new one appears by itself, drawn from the CSS the plugin declares. marks.test.ts pins that every
mark the app writes has a row, that each plugin format's row is its delimiter around its words, and that the
spoiler's row is smoke.


## What's new: a changelog of every release (2026-09-15)

Matt: "show a changelog with all updates including OTA." Nothing published a history, so a person on 1.4.1-2 had no
way to see what 1.4.1-3 changed, or what they already had.

- **The site keeps it.** Each deploy writes `/glyph/changelog.json` from the one that is live, newest first, capped
  at sixty: version, build, when, the notes the deploy carried, and the APK version when one went with it
  (`scripts/deploy-ota.mjs`). Carried forward from what is published rather than from any machine, so a deploy from
  another Mac adds to the same list; `scripts/changelog-seed.json` holds the releases that went out before there was
  one, used only when nothing is published yet.
- **Settings shows it** (`core/changelog.ts`, Settings > What's new). Read from wherever the app takes its updates,
  kept for reading with no signal, and the release running is marked. It is words, not code: unsigned, fetched
  plainly, while the bundles it describes stay signed and checked. The web version reads the file beside its own page.

## Boards, written in markdown: out, and back with a generic link (2026-09-16)

Built, shipped in 1.4.1-7 to 1.4.2-1, removed the same night ("for now the board view is too much remove this code"),
and asked for again the next morning: "bring back the board functionality and formatting rules, add it to the
specification / cheat sheet. come up with a generic way to link list items to the board." The standard is
docs/BOARDS.md and it is still two pieces of ordinary markdown, with one of them now doing more.

- **An anchor names an item**, and that is the generic link. `- [ ] Ship the pricing page ^ship-page` still works, but
  so does `- Ask Sam about the copy ^ask-sam` and `1. Unplug it ^unplug`: any list item, not only a to-do, which is
  what makes the link generic rather than a board feature. A card for an item with no box is drawn with a dot instead
  of a tick. The regex takes an anchor only after whitespace and before the end of the line, which is what keeps
  `E = mc^2^` a superscript.
- **Anything can point at an anchor.** `[[#^ask-sam]]` in the middle of a sentence goes to that line, and
  `[[Note#^ask-sam]]` to one in another note (the title half is `editor/wikiLinks.ts`, which skips a `[[#` outright;
  the anchor half is `core/boards.ts`). A **fenced ```board block** is then one more thing that names anchors, rather
  than the only thing that can.
- **A card is its item** (`core/boards.ts` reads and writes the whole syntax; `editor/boards.ts` draws it). The
  card's tick box is the item's box, its words are the item's words, and tapping them puts the caret on that line. A
  column called Done means done: ticking a card moves it there, dragging it there ticks it, and dragging it out
  unticks it.
- **Press and hold to drag** (Matt: "add a way to tap and drag to re organize items in lanes"). The card itself stays
  in the column as the gap it would leave and moves from place to place as the finger goes, while a copy follows
  overhead; `putCardAt` writes it where the gap was, so a card reorders inside a lane as well as moving between them.
  Before the hold is up the finger still scrolls, and a card held at either edge scrolls the board along.
- **Friendlier on a phone**: columns that snap one to a screen, a column name that stays while its cards scroll, an
  empty column that says it will take a card, thumb-sized targets with the chevrons kept for a hand that would rather
  not drag, and a **+** that opens a field for the new card's words and writes the to-do and its card together.
  The first + put the caret into an empty `- [ ] ^item` line, which left every new card named `^item`, `^item-2`,
  and put the caret one place short of the box's space; asking for the words first removes both, and the board is
  redrawn in place (`updateDOM`) so the field and the keyboard survive each card. The `^anchor` at the end of a line is drawn small and faint, so the line reads as its words.
- **The fence stays the truth.** Tapping it puts the caret inside and the drawing steps aside, the way a table does
  (`editor/tables.ts`). A card whose item is gone is drawn with its anchor, so nothing disappears quietly.
- **The example note** (`core/boardNote.ts`, Settings > About > Add the example board) is a working board with two
  fences in one note, and says in its own words how to change it.

## The board again, and the robot moves house (2026-09-16)

- **Text arrives quicker still.** Matt asked twice: after the 33% boost, "speed up the wisp animation on text". The
  arc, its jitter and the stagger are another quarter off in `editor/wispArrivals.ts`, and `art/WispText.tsx` is the
  same with its letters at 16/9 of the asked-for pace.
- **The drawer handle is a bar again.** The grab band I gave it (`NoteSettings.module.css .grip`) put a full radius on
  a 40×30 box, and the clipped background came out an ellipse (Matt: "handle on drawers are ovals instead of
  rectangles with rounded caps"). The band is now plain and the bar is its `::before`, 44×4 with 2 px caps.
- **The robot lives in More.** Matt: "move robot dropdown in topbar into more drawer with an AI group label", and
  "give the dropdown for the robot tools like formatting glass mode". Format, Summarize and Enhance are rows under an
  AI heading in the note's More sheet, the group in glass, the mode showing marked with a dot; the header keeps the
  bookmark, the mic and More. `format/RobotMenu.tsx` and its CSS are deleted, nothing imports them.

## The marks are one plugin

Matt: "move all the additional formatting to one single plugin instead of one of each like shout redact unsure etc."
`plugins/marks/index.tsx` is now a single Marks plugin holding all seven formats, the spoiler among them (its own folder
is gone), with one switch in Settings > Plugins. So the Style page and the guide's table could still show a mark's own
sign rather than the plugin's, `InlineFormat` gained an optional `icon`, which `editor/ContextMenu.tsx` prefers over the
plugin's.

## One GitHub plugin: repos, and issues that tick both ways

Matt: "make a GitHub issues plugin that allows us to sync list items with GitHub project issues, or make it part of an
overall GitHub plugin that's provided by default like Notion." The Projects plugin became that plugin
(`plugins/github/`, id `github`, standard): one link on a note, "GitHub repo", doing both jobs.

- **Issues** (`issues.ts`, `details.ts`). A list item sent becomes an issue on the linked repo and its words become a
  link to it, `- [ ] Ship the page [github](https://github.com/o/r/issues/12)`, the shape Notion's items already use.
  The pill says whether it is open; the card lists the repo, the number, who has it, its labels and milestone. Because
  the provider's stage is plain (open is to do, closed is done) and its actions are called `done` and `reopen`, the
  tick works both ways with no editor change (`editor/doneSync.ts`, `core/markDetails.ts`): ticking the box closes the
  issue, and an issue closed on GitHub ticks the box. Reads are paced two at a time, fresh for 45 seconds, and the last
  300 are kept (`glyph-github-issues`) so a note opened offline still shows what its issues last were.
- **Sending** needs a token; reading needs none. The token has moved into the plugin's own page in Settings, where it
  can be typed rather than only offered while linking a private repo, and every place that would send says so when it
  is missing.
- **Context** is unchanged (`repos.ts`, once `projects.ts`): the repo read on the phone into a briefing the model gets
  with the note. The storage keys are the same, so repos and links carry over; only the plugin's id changed, which
  resets its switch to on.


## The press-and-hold menu, in full (2026-09-16)

Matt: "add a full context menu for text and such." The menu had Cut, Copy, Paste, Find, Select all, Style and Add
image; it now carries the rest of what a person expects of a line, and two of Glyph's own.

- **Duplicate, Delete, Move up, Move down** (`editor/format.ts`). With words selected they work on the selection;
  with none, on the line the caret is on, which is what a finger has usually just tapped.
- **Add to board** (`core/boards.ts` `addToBoard`, docs/BOARDS.md). On a list item in a note that holds a board, this
  gives the line an anchor made from its own words and adds the card, in Done when the item is already ticked.
  Nothing shows on a line that is not a list item, in a note with no board, or on an item already on one.
- **Send** is the plugin's own item action, the one a swipe on the item does (a Notion board, a GitHub issue), so the
  same thing can be done without knowing about the swipe.

## The cheat sheet draws its examples with the editor (2026-09-16)

Matt: "the cheatsheet is disorganized and ugly please redo it with better iconography and layout also make sure were
using the real formatters as some things like spoilers isnt using the right one (wisp)". Both halves of that came
from the same cause.

- **The examples are the app now.** The guide's table and the cheat sheet each used to draw every mark a second time
  in CSS, which is how a spoiler ended up a `blur(3.5px)` on one page and real smoke in a note. `guide/MarkExample.tsx`
  is the note's own editor, read-only, in `formatted` view, with the same extensions and the same switched-on
  plugins: the spoiler is the wisp filter, the code block is the real highlighter, a table is a drawn table and a
  board is a working board. A mark that changes in the app changes on both pages by itself, and the bespoke look CSS
  is gone. An editor per row is a real thing to build, so a row builds one when it comes within a screen of being
  looked at (`IntersectionObserver`).
- **A mark is a card.** Icon, name, the characters in a ring, the line to type, then under a rule the line as it
  reads. Every row carries its own icon in `guide/marks.ts` - a plugin's mark uses the icon the plugin declares - and
  the page is a grid that gives a phone one column and a folded phone two, with a board taking the full width.
- **A field to find a mark** by its name, its characters or the words of its example, above the group chips. Looking
  something up was the whole point of the page and it was a scroll.

## The microphone is only open when something is being recorded (2026-09-16)

Matt: "disable the always on microphone only enable it when actually recording or in memo mode, remove the wake work
functionality completely". The wake word is gone, not switched off: `capture/wakeWord.ts`, `capture/useWakeWord.ts`
and their test are deleted, with the `listenWhileOpen` preference, its Settings row, the handoff the recorder took
from it (`takeWakeHandoff`, `wakeSettled`), the `woke` screen state, and the tutorial tip that taught it. This
reverses the section of 2026-09-16 above ("While Glyph is open I should be able to say the AIs wake word"), which had
itself reversed the pause of 2026-09-13.

- **`prefs.commandWord` stays.** It does a second job: it is what makes a spoken command need "Glyph" in front of it
  *while a recording is running* (`capture/command.ts`), which is not an open microphone and is what keeps "Glyph, add
  buy milk to HelloTrade" apart from a sentence about Glyph. Only the listening is out.
- **One thing opens a microphone.** The recorder (`capture/CaptureScreen.tsx`, memo mode included, since a memo is
  that screen in another mode). The voice tutorial, which opened it for its practice lessons, was removed on
  2026-09-17 (see below).
- **The guide's rings stopped listening too.** `guide/micLevel.ts` opened the microphone on the side-key page so the
  rings could answer a voice; a page that is only read is no place for it, and the rings keep their resting beat.
  The file is gone.
- Nothing in the Kotlin side ever held a microphone: the side key launches the recorder, it does not listen.

## 51. Glyph on a Mac

The desktop app (`npm run desktop:dev`, `desktop:build`) is the same page in WebKit, the engine the Mac and iPhone
apps share, so three things are shaped for it:

- **The title bar.** The window draws under a transparent bar, with its three buttons inset into it
  (`src-tauri/src/lib.rs`). `core/platform.ts` marks the Mac app with `data-titlebar="overlay"`, so app.css gives
  `--app-safe-top` 44px there (every header already pads by it) and lays `.app-dragBar`, a
  `data-tauri-drag-region`, over the strip, which drags the window and zooms it on a double click.
- **What a filter's region costs.** A filter region has a budget of 2^24 device pixels, and a filter asking for more
  is not clipped or scaled down: in WebKit the element paints solid black. That is what took the wisp edge off the
  Mac (Matt: "the whole page is going black when I scroll down", and later "on desktop the wisp effect isn't working
  on the scrolling"), and the guide's headline with it. It was read at the time as WebKit being unable to draw a
  filter measured in its own coordinates (`filterUnits="userSpaceOnUse"`), and both effects were stood down behind
  an `isWebKit` flag. The units were never the problem. Measured in headless WebKit on the app's own filter:
  4096 x 4096 draws and 4200 x 4000 is black, 16000 x 1000 and 3000 x 5000 both draw, so it is area and not a limit
  on a side; at two device pixels to the CSS pixel the boundary moves to 2048 x 2048 exactly, so the budget is
  counted in the screen's pixels and a sharp screen spends four for each one the page asks for. The region we shipped
  was 4000 x 60000 - forty times over - because it was one guess big enough for any view.

  So the region is sized to the view that wears it: `placeRegion` (art/wispEdge.ts) sets it from the window each
  time the hook fits, and `wispFoot` takes the lane's own width instead of a width wide enough for any lane. The
  app's window is 430 x 860 and a laptop's is not much more, so both sit far under; a window so large that even a
  fitted region is over budget wears no filter at all and keeps its mask fade, which is the one case the old
  stand-down still covers. Nothing outside a filter's region is drawn, so the region is set before the element wears
  the filter, never guessed in the markup. `isWebKit` and `data-engine="webkit"` are gone with the stand-downs.

  The lesson worth keeping is the shape of the mistake, not the number: a fix that worked (percentage units) was
  read as an explanation, and the explanation was wrong in a way that cost the Mac an effect for a day. What settled
  it was bisecting the boundary until it had two sides.

  Its sister, found the same night on the workspace pills: **a number quoted in a comment or a message outlives the
  code it described.** The matched pill geometry was passed between sessions as `0.35em`, which had been true for
  about an hour before it was replaced by `0.52em 0.8em`; carried forward, it would have quietly un-matched the very
  pills that had just been matched (notes/NoteTabs.module.css `.space`, notes/NotesList.module.css `.rowSpace`, both
  on `--glacier-font-size-xs`). The quote was honest and stale, which is the dangerous combination. Grep for the
  number rather than remember it, and when two files must hold the same one, derive the second from the first -
  plugins/LinkMarks.module.css sizes its ring off the badge's own tokens for exactly this reason, so a change to the
  padding carries rather than rots.
- **The sidebar.** On a window with the shape for two panes (`useSidebar`, core/useWideScreen.ts) the notes list
  sits in a column beside the open note (Matt: "on widescreen desktop I would like to see a sidebar with all notes
  in them"): each is its phone screen, sized to its pane.

  The rule asks about the window, not the device (Matt: "On a wider display we should just use the desktop layout").
  It used to ask `!isMobile` as well, so a Fold opened out or a tablet kept the phone layout however wide it got -
  the very case the split is for, on the phone Glyph is built on. What it asks now is 660px across (the list's own
  300px column and a note beside it no narrower than a small phone) AND either 600px tall or a fine pointer: a phone
  held in landscape is as wide as a small desktop window and about 390px tall, with nowhere to put a list, while a
  short window on a desktop is one the person chose. Measured across the shapes it has to separate: phone portrait
  and landscape keep the phone layout, a Fold opened out in either orientation splits, as do a tablet, a 1280px
  desktop and a 900x500 one, and a 600px-wide desktop window does not.

  The threshold lives in that one expression. App.tsx stamps `data-split` on the root and the stylesheets ask the
  stamp - the tab bar's ground across a split window (app.css) and Settings becoming a card rather than a screen
  (settings/settings.css, twice). Those were three copies of `900px` written to agree with it, which is three chances
  for the app to change shape at three widths and no way to notice when they drift. A stamp carries no number. The open note's row is marked (`selectedId`), the note
  drops its "← Notes" (`showBack`), the list is read again a moment after each save so titles follow the typing,
  and with nothing open the pane says so and offers Speak and New note (notes/NoNoteOpen.tsx). Recording, review,
  sorting and the tutorial still take the whole window.

## Scrolling past a board, its handle, and smoke in its lanes (2026-09-16)

Three open cards on the Glyph Tasks board, all in `editor/boards.ts`:

- **Scrolling past boards stopped.** Matt: "scrolling past boards is glitchy and stops scroll momentum". There were
  three causes:
  - **The height before drawing.** CodeMirror sizes what it has not drawn by the widget's `estimatedHeight`, and
    the board had none, so it counted as one line (31 px). When a board came into view from above, the editor
    moved the page by the difference (345 px on the test note) to keep its place. On Android that move ends a
    fling. The widget now answers the height it was last drawn at, kept by a hash of what it shows in
    `glyph-board-heights`, or a height worked out from its lanes and the length of its cards' words. Measured
    cold, the guess came within 0.03 px of the drawn board and the page did not move.
  - **Margins.** The board's top margin and the wrapper's bottom margin also stood outside the border box the
    editor measures, so every line under a board was 16 px from where the editor had it. They are padding now.
  - **Lanes that kept the finger.** Lanes stopped at a cap, scrolled, and had `overscroll-behavior: contain`, so a
    fling that landed on a full lane scrolled the lane and stopped the note dead. A lane with no set height now
    shows every card. A lane with a set height scrolls and passes the finger on at its ends. The board has
    `overflow-y: hidden`, since a sideways scroller is a vertical one too. A held card near the screen's top or
    foot rolls the note, because the lane no longer rolls itself.
- **The handle is the plain grip again.** Matt: "the resize handle under the board changed and doesnt match the
  simplistic version anymore". The tab with chevrons, a ring and a shadow is back to Glacier's grip pill, 1.5 rem by
  6 px at 45% ink. It turns white when held.
- **Lane feet smoke.** Matt: "the blur at the bottom of the swimlanes should be the wisp effect we use on text".
  - The page's `#wispEdge` filter is placed for one view at a time, so a lane can't wear it. `art/wispFoot.ts`
    makes the foot half of it at a given height, one filter per lane height, shared and kept.
  - A lane wears it only while it has cards below its foot (`data-more`), over a 1.2 em fade.
  - The smoke is off with Settings' smoke, with reduced motion and where the filter's region would be over budget.
    Those keep the fade. (It was off in WebKit too, which §51 undid, and which is what left the two faults below.)

## The board a list is already on (2026-09-17)

- **Ticks and lanes stopped drifting apart.** An item ticked anywhere is DRAWN in the Done lane, but nothing moved its
  id, so Matt's Task Management note ended with seventeen ids under `To do:` drawing two cards, and he read the fence
  and asked where the others had gone. Most of those ticks came from Notion, not from taps. A box turned in the list
  now moves its card in the same edit and the same undo, and any other card whose item is ticked settles at the same
  time, so a note that has drifted comes right with the next change (`core/boards.ts` `settleBoards`,
  `settleColumns`; `editor/boards.ts` `settleFences` for editor/taskToggle.ts and editor/doneSync.ts). A card the
  person has just moved by hand is left where they put it.
- **Two reader fixes found while looking for that.** An id written into two lanes was read into both, so it was drawn
  twice in the first and the lane he had put it in drew nothing; it now belongs to the first lane that has it. An id
  that was not already an anchor (`Fix Login`) was dropped without a word and gone from the note at the next change;
  it is now read as the anchor it means, but only when the note has an item with that anchor.
- **Add to board** (Matt: "add an 'add to board' option when other items in the list are in a board already"). The row
  was called To board and always used the nearest board above, in its first lane. It now uses the board the item's own
  list is already on, and puts the card beside the neighbour it follows in the list, so the board keeps the list's
  order. Where it went is said aloud, since the board is often off the screen.

## Glyph Academy (2026-09-17)

Matt: "we need a Glyph Academy section that teaches you markdown then teaches you the extra stuff we have. Build the
academy section start with just the markdown basics set it up as a live code type thing where it teaches you then you
type it and see it format below."

- **A lesson is one mark** (`academy/lessons.ts`): a line or two on what it does, an example to look at, something to
  write of your own, a check, a word of praise and a hint. Thirteen of them in the first chapter, Markdown basics, in
  teaching order: title, heading, bold, italic, struck through, code, link, list, in order, to-do, quote, dividing
  line, block of code. Pure, so every lesson's example is a test that its own check passes.
- **The check is on the mark, not the words.** Any title passes the title lesson; extra lines and other marks are
  fine, since somebody learning is usually trying things. A lesson can also be skipped.
- **The live page** (`academy/Playground.tsx`) is the point: a plain field in the typewriter face above - autocorrect
  and autocapitalising off, or a phone turns `# weekend` into `# Weekend` and the underscores into quotes - and under
  it the note's own editor, read-only and formatted, redrawn as the words change. The same trick as the cheat sheet's
  examples (`guide/MarkExample.tsx`): the real marks drawn by the real app, so what is learned is what a note does.
- **The lesson in hand is held in state, not worked out from what has been learned.** Deriving it meant passing a
  lesson moved the page on the instant the mark was typed, and the whole point is to stay and watch it format. It is
  ticked where it stands, Next appears, and nothing is taken away.
- **Progress is kept** (`glyph-academy`), so it opens at the first lesson not passed, and any lesson can be taken
  again from the summary. Nothing typed is saved as a note.
- **The way in** is Settings > About > Help > **Glyph Academy**, where the voice tutorial's row used to be, and a card
  on the notes list for anyone who has not started (`academy/banner.ts`, `notes/NotesList.tsx`; Matt: "I'd like the
  academy page to show up on the home screen kinda like the update banner for new users as a call to action banner").
  It is shown while no lesson has been passed and it has not been put away, so passing one takes it off.
- The summary points at the cheat sheet for Glyph's own marks - boards, spoilers, callouts, anchors - until their
  chapter is written, which is the next piece of this.

## Mermaid diagrams, drawn (2026-09-17)

Matt: "Add support for Mermaid charts".

- **A ```mermaid fence is drawn as its diagram** (`editor/mermaid.ts`), the way a table is drawn as a table and a
  board as a board: the text is what is kept and edited, the drawing steps aside when the caret goes in, and a tap
  puts it there. The fence is read by hand rather than from the syntax tree, as boards are, and the word has to be
  the whole info string, so a note *about* mermaids is not a diagram.
- **Mermaid itself, every diagram type.** The size was put to Matt before it was built: the app is 5.2 MB over the
  air, mermaid 12 minified is 5.4 MB across 102 chunks, and flowchart plus sequence alone would have been about
  1.5 MB. He chose everything, so the payload roughly doubles. It is imported the first time a note actually has a
  diagram, so startup is unchanged, and since the OTA brings every file down to the phone, that import needs no
  network: diagrams draw offline.
- **A diagram that cannot be drawn stays as its own text**, in the typewriter face, with one quiet line saying why -
  the diagram is wrong, or the library never arrived (a browser with no network). No spinner that never ends.
- **Drawings are cached** by what the diagram says and which way the app is painted, and **heights are remembered**
  between launches (`glyph-mermaid-heights`), so the editor knows how tall a diagram is before drawing it and the
  note does not jump as one scrolls into view. That is the same lesson boards taught (docs/BOARDS.md).
- **A drawn diagram carries its colours inside its picture**, so unlike everything else in the editor it cannot
  follow a CSS variable: a small view plugin watches the theme setting and the phone's own scheme, and redraws every
  diagram on the page when either changes. Found by drawing a dark diagram on a light page.
- The cheat sheet has a row for it (`guide/marks.ts`), which draws a real diagram with the real editor.

## A board's cards get a menu, and the note's stays off them (2026-09-17)

Two cards of Matt's, which are two halves of one thing: "Formatting menu shows up on board unexpectedly" and "Add
context menu to board items for moving lanes and adding to notion etc."

- **The note's menu is about a line of text, and a drawn board is not one.** Both ways it opens - the phone's own
  `contextmenu`, and the timed long press for a line with no word under the finger (editor/ContextMenu.tsx) - now
  ignore a press that lands inside a drawn board or a mermaid diagram. The fence's own lines still have it: tapping
  a board puts the caret in the fence and the drawing steps aside, and there the menu is a menu about text again.
- **A card's menu opens from a button, not a press and hold**, because a press and hold is already how a card is
  picked up to drag. A small **more** beside the chevrons.
- **It sits in the lane, under its card**, the way the + field sits at the top of a column: nothing to place, and it
  scrolls with the board. It closes on a choice, on a press anywhere else, and on Escape.
- **What it offers**: every other lane to move to (through the same `land` a drag uses, so crossing into Done ticks
  the item and out of it unticks), the tick, the line in the note, what a plugin offers this item, and **Take off the
  board** (`core/boards.ts` `withoutCard`), which leaves the item exactly where it is in the note.
- **The plugin row asks by line first.** `cardActions` carries the same two seams the note already uses: the per-line
  suggestions (editor/suggestions.ts) and, only where a line has no offer, the action a swipe would run by text
  (editor/swipeItems.ts). A card names an exact line, and sending by text alone would send
  the wrong one of two items that read the same way. Nothing here reaches into a plugin.

## 52. The top bar carries two rows, and a screen's controls (2026-09-18)

Matt: "Move the controls for the note into the topbar and put the tabs on the next line down", then "This row can be
hidden when there are no tabs open".

- **Two lines, one bar.** The controls sit on the top line - the sidebar's button, the two arrows, and whatever the
  screen puts at the far end - and the open notes run underneath. The second line is not rendered at all when nothing
  is open, so a note reached from the list carries no empty strip. `--app-tabs` says which of the two heights the bar
  is (`app.css`, `:root[data-tabs='on'|'rows']`, set by `App.tsx` from `openTabs.length`), and `--app-safe-top` carries
  it as it always did, so every screen's header clears the bar without knowing the bar exists. Measured: 92px with
  tabs, 56px without.
- **A screen's controls reach the bar by portal** (`core/topBarTools.ts`, `notes/NoteTabs.tsx`, `editor/NoteScreen.tsx`).
  The note's tools hold the editor's state - the view being shown, the bookmark's line, the tape - so lifting them into
  `App.tsx` would lift the editor with them. Instead the bar offers a slot, the screen keeps owning its buttons, and
  React puts them in the bar's DOM. A screen renders its controls where they have always been when there is no slot,
  so a route with no bar still works.
- **The ring takes the tap, never the box around it.** The bar passes clicks through to what is under it
  (`.app-tabBar > *` is `pointer-events: none`), so anything meant to be pressed has to say so - and saying it on the
  slot made the slot's whole area a target, swallowing clicks in the few pixels between two rings. This is the same
  bug the tabs row had at 974px, at a tenth of the size, which is the point: it is a class, not an incident. The test
  that settles it is `elementFromPoint` at a spot with no control on it, at a narrow width and a wide one; the answer
  should be the header pane underneath.
- **Exact is not a fit.** At 360px - a fold closed - the seven rings on that line came to exactly its width, 316
  against 316. Tightening the air between them bought the ten pixels, but a row that fits exactly is one larger type
  setting or one more control from cutting the last one off with nothing to show for it, so the line scrolls sideways
  rather than clipping. Reachable beats invisible.

### Three gestures on one row

The tabs take a press, a drag and a wheel, and each had to be asked for before it was there (Matt: "add dragging
around tabs into different positions", then "moving tabs doesn't look like you're actually moving it, doesn't follow
my finger", then "I should be able to scroll left or right on the tabs to see overflowing ones", then "the clicking
and dragging is eating me moving the tabs - the tabs should only move when I press and hold").

- **Hold to pick up, drag to pan.** A press that stays put for 220ms picks the tab up; a press that moves before then
  pans the row by its `scrollLeft`. One rule for a finger and a mouse alike: the mouse had its own, reordering the
  moment it had travelled six pixels, so a click that slid under the hand carried the tab with it.
- **The wheel pans it too.** A mouse has no sideways wheel, so a vertical one over the row is spent on `scrollLeft`;
  a trackpad's own `deltaX` is preferred when it is the larger of the two. Without this the row could not be scrolled
  on a Mac at all, which is how it was for a day.
- **Why the pan is ours and not the browser's.** The row carries `touch-action: pan-y` so a vertical swipe still
  scrolls the page natively. That also tells the browser not to pan the row sideways, so the sideways movement
  arrives as pointer events and is spent by hand. Granting `pan-x` instead would hand the gesture back to the browser
  and take the reorder with it.

Three things about the drag are easy to get wrong, and all three were:

- **Follow the pointer on the window, not on the tab.** Reordering moves the tab's own element, which drops a pointer
  capture held on it: the drag then loses its end, no `pointerup` arrives, and every later tap is swallowed as "the
  click that ends a drag". Window listeners see the whole gesture whatever React does underneath.
- **Measure the places from the tabs that are not moving.** The dragged tab carries an offset so it can follow the
  finger, which moves the box it would otherwise be measured by, so including it makes the row swap and swap back as
  the measurement chases the thing that caused it. The place is counted from the other tabs' middles.
- **Swallow the click that ends a drag**, and clear that flag on the next turn rather than on the click, since a
  gesture that ends off the tab sends no click at all.

### What the DOM says depends on when you ask it

Three things looked broken tonight and were not: a wheel that scrolled one way, an overflow fade that never appeared,
and a blank note pane. All three were reads taken before React had committed, or a screenshot caught mid-load. Each
would have become a bug report to somebody.

A read straight after an action measures the timing, not the app. Attach a listener and inspect what it captured, or
wait a frame and read again, before believing that something is broken - and especially before telling someone else it
is. The suite was green through all three, because none of them were things an assertion can see.

## 53. Make the environment real before calling a bug unreproducible (2026-09-18)

Four bugs got past a green suite in one night, and three of them were found the same way: not by reasoning about the
difference between here and there, but by making here actually be there.

- **The filter region that painted black** (section 51) was found in a headless WebKit, not argued about from Chrome.
- **The glide that would not run** was found in a headless Chromium with reduced motion explicitly turned off, which
  is the state a developer machine is rarely in and a phone often is.
- **The top bar over the workspace pills** (section 52) could not be reproduced in a browser at any width - 26px clear
  every time - because it only exists where the window has a title bar. Stamping `data-titlebar='overlay'` on the root
  turns on the Mac's 44px inset, and the overlap appeared immediately: bar bottom 136, pills at 118.

The shape each time: a report that looks wrong because it cannot be seen locally, and a local setup that differs from
the reported one in exactly one arrangeable way. The inset, the engine, the motion preference - each is one line to
turn on. "I cannot reproduce it" is a statement about the setup, not about the bug.

**Test the worst case, not the fix.** Once the overlap was fixed the fix could be proven the easy way, by measuring it
working. The better test was to delete `--wisp-under` outright at Mac geometry - the state where the observer never
fires at all, which cannot otherwise be arranged - and measure again: 27px clear, against 85px of overlap before. That
says the floor holds when the measurement fails entirely, which measuring the happy path never would.

**And a fallback stands in for something, so it has to be related to it.** `var(--wisp-under, 3.2rem)` was picked
because 3.2rem was roughly the bar at the time; the bar then changed three times in an evening. A fallback that is a
snapshot of another value is wrong from the first change onward, and silently - it is only read when the real value is
missing, which is exactly when nobody is looking. Derive it (`--app-safe-top`) or do not have one.

**Emulating a device's size is not emulating the device.** Two sessions measured the same eight window shapes against
the new split-layout rule and disagreed on one: a phone in landscape, 850x390, which must keep the phone layout. The
rule asks for width AND either height or `(pointer: fine)`, and a headless browser given only a viewport reports a
fine pointer at every size - so the shape passed in one harness and failed in the other, which had `hasTouch` and
`isMobile` set. Neither of us had reasoned it out; one harness happened to include the thing under test. Any rule that
asks about pointer, hover or touch inverts silently under a viewport-only harness, so set the device emulation, not
just the size.

**The tab bar is the worked example.** `--app-tabs` began as one number for a row holding a 40px button, became
`calc(3.5rem + 2.25rem)` when a second row of tabs arrived, and is now the sum of two rows that each measure
themselves - the controls' own expression and the tab's own height, which is the workspace pill's. Three revisions of
one rule, and the first two were each a number standing for something that then moved: the pill changed size four
times, and Appearance > Spacing scales the rings from 27.4px to 56.9px, which is 0.9px past the 56 the bar had set
aside. Each revision was found by a person looking at the screen, never by a test. What the derived form buys beyond
not clipping: at the tightest spacing the bar is now SHORTER than the guess it replaced - 91.8px against 99.2 on a
phone with two tabs - so a setting that asks for less chrome gets it, without anyone choosing a smaller number.

**A limit counts everything inside it unless it says otherwise.** Three of the night's bugs were a number that did not
count what its name suggested: the filter region measured in device pixels rather than CSS ones (section 51), a ring
of `max-inline-size: 7ch` on a border-box pill that spent 17.8px of the seven on its own padding and drew about three
characters of "Engineering", and a tab whose height came from whichever child happened to be tallest. Written as what
they count - `calc(8ch + 1.6em + 2px)`, a height derived from the pill's own parts - they stay true when the parts
change. The pill changed size four times in two days.

## A highlight can be told its colour (2026-09-18)

Matt: "Add a colour option on the highlight supporting the colour names from the glacierUI kit."

- **No new syntax.** `==the cabin key==(green)` uses the brackets a note on a mark already uses
  (editor/markNotes.ts). One shape for "something in brackets after a mark", and **the mark decides what it means**:
  the format answers `tint(name)` (plugins/types.ts), a name it knows is a colour, and anything else is still a note.
  The brackets are hidden either way, so the line reads as its words; only the tap differs, since a colour has
  nothing to say.
- **A name, not a colour**, as with the workspace hues: the note carries `green`, the wash is
  `color-mix(in oklch, var(--glacier-green-9) 34%, transparent)`, and the kit can retune green without touching
  anybody's note. A name this build does not know draws the plain highlight rather than nothing.
- **The colours are the kit's own ramps** and nothing invented here: blue, red, amber, green, teal, purple, gray.
- Measured in the browser rather than read: the plain wash draws at hue 250, green at 150, amber at 75, red at 25,
  and both an unknown name and a real note stay at 250.

## Theme becomes Appearance (2026-09-18)

Matt: "Change theme to be appearance settings and add the density controller, the accent color picker and the
rounding control in there as well as the other existing theme options."

- **One page for how the app is drawn**: the page (light, dark, system), then its accent, its spacing and its
  corners, then the colours of code. Spacing moved here from Type, where it had landed first.
- **The accent is the one way out of grey.** ink.css maps every accent token onto the grey scale, which is what makes
  Glyph grey; that mapping now sits behind `:not([data-accent])`, so choosing a colour lets the kit's own ramp show
  through (tokens.css carries graphite, red, amber, green, teal and purple) while paper, ink and every grey stay put.
  `ink` is the default and stamps nothing. The focus ring came with it: a ring round what has the keyboard is exactly
  what an accent is for, so it is ink with no accent and the accent's own when there is one.
- **Rounding is one multiplier** over the kit's whole radius scale (`--glacier-radius-scale`), stamped as
  `data-rounding`: Square 0, Soft 0.55, Round 1 (the kit's own, stamped nothing), Roundest 1.5. **Pills are untouched
  at every setting**, since `--glacier-radius-full` is a flat 9999px - so Speak stays a pill while every card squares
  off. Measured rather than assumed: a `radius-lg` box draws 16px, 0px, 8.8px and 24px at the four settings.
- **The swatch shows the real thing.** Each dot wears `data-accent` itself, so it is painted by the very ramp that
  choosing it would give the app rather than by hex values kept beside it.
- **A name, not a colour, is stored**, as with the workspace hues, and a name this build does not know - `blue` from
  the old store, where the accent was a colour the app never drew with - reads as the app's own rather than stamping
  something nothing can draw.

## A tick can put an item on the board (2026-09-18)

Matt: items were not moving to Done when he ticked them. Every function was behaving: measuring his note
found three ticked items with no `^anchor`, which are therefore not cards at all, while the other 57 moved correctly.
Two identical-looking to-dos behaved differently and nothing said why - a bug from where a person sits, however
correct the code.

- **Ticking an item that is not a card now adds it**, to the board its own list is already on, in Done, with the
  anchor written at the end of its line (`core/boards.ts` `settleTicks`).
- **Scoped to the list.** docs/BOARDS.md says a board never has to hold every item in the note, so an item in an
  unrelated list further down must not leap onto the board because it was ticked. Its neighbours decide.
- **The anchor is appended, not the line rewritten**, so the edit can never overlap the one character the tick itself
  changes at the start of the line - two changes in one transaction, one undo.
- The alternative - saying why nothing happened - was smaller but leaves the note holding two kinds of to-do that
  look identical. This finishes the thought instead, and is visible and reversible: the card menu takes it back off.

## The workspace pill is a badge again (2026-09-17)

Matt: "Workspace pill doesn't have same left and right padding as top and bottom around the outside."

- **It was 17.8px at the sides against 8px above and below** - the pill's height came from `min-block-size` while its
  sides came from a space token, so the two were never related. An even ring now: `padding: 0.6em`, with the min
  height kept for the tap target.
- **The line box is pinned to the words** (`line-height: 1`), or the font's own slack above and below counts as ring
  and the sides look tight beside it. It has to sit AFTER `font: inherit` in the rule: that shorthand resets
  line-height, which is why the first attempt did nothing.
- **The pills stopped stretching to the tallest item in the row** (`align-items: center`). The **+** is a different
  size, so every pill inherited its height and got a taller ring than the sides they had just been matched to. The +
  is now a round button the height of a pill rather than a pill with one stroke in it.
- The tag a note's row wears got the same ring, and is nudged back onto the time's own line.

## A board holds its height (2026-09-17)

Matt: "Clicking an item to toggle the done state on and off is now super laggy and doesn't actually change the state
off." Two taps in the same place, and the second one missed.

- **The note moved, not the tick.** A board's lanes are as tall as the tallest lane's cards, so the moment a tick
  moved a card between lanes the board's own height changed and everything under it jumped - 48 px in the case
  measured here, in both directions depending on which lane won. The second tap landed on whatever had slid under
  the finger: the next item, or the board itself. Measured precisely, the collapse was reproduced with a
  raw character change, which proved it was the drawing and not the fence write.
- **So a board settles its height when it is drawn and holds it** (`pin`, `--cm-board-pin`): ticking, dragging,
  adding and taking off all leave it where it is, and the lanes scroll inside as a board with a set height does. It
  is let go when the board is built again - the note reopened, its columns changed - when the line under it is
  dragged, which writes a real height, or when the words change size, since the pin is in pixels.
- It is measured in the editor's own measure cycle rather than on an animation frame, so a note opened in a hidden
  tab pins as soon as it is looked at.
- No unit test covers it: jsdom gives every box a height of zero, so a layout pin cannot be seen there. It was
  verified in the browser instead - board height unchanged across a tick, the lines under it not moving, and the
  second tap landing on the item it was aimed at.

## A colour for a workspace (2026-09-17)

Matt: "add the ability to choose from a swatch of colours for the workspace pill colour".

- **Colour as ink, not as a fill.** The app is grey everywhere by design, so a workspace's colour is the one place
  colour carries meaning: which workspace a note is in, seen without reading. Six hues and the app's own ink, and a
  hue is worn by the workspace's pill on the list and by its tag on a note's row.
- **A name, not a colour, is stored** (`core/workspaces.ts` `WORKSPACE_HUES`, `setWorkspaceHue`). What each hue looks
  like belongs to the page (ink.css `[data-hue]`), so the swatch can be retuned without touching anybody's
  workspaces, and a hue from a newer phone reads as ink rather than as a broken colour.
- **One lightness per paper.** `--app-hue-lift` sits with the grey scale and flips with it - 0.55 on white, 0.78 on
  black, and flipped again on an inverse surface - so the same six hues read on every ground the app has. That is
  why the hues are written as `oklch(var(--app-hue-lift) var(--app-hue-chroma) <angle>)` rather than as fixed
  colours.
- **The swatch** (`notes/WorkspaceSwatch.tsx`) is a radio group of dots: arrow keys move between them, and the chosen
  one wears a tick as well as a ring, so it is never colour alone that says which is picked. On a workspace that
  exists the colour is set as it is tapped, since it is a thing to look at: the pill behind the sheet changes under
  your finger. A new one carries its colour into the making.

## A home page, and the notes list gone (2026-09-18)

Matt: "Add a 'home' button to take us to a dashboard like page", with Glyph's own mark as its icon; he chose a new
page on every screen, the phone's start page included, and then "Delete the code" for the list it replaced.

- **The button** comes first in the top bar, before the sidebar's (`notes/NoteTabs.tsx`; Matt: "Move the home
  button to the left of the sidebar button"). It was first drawn as the app icon's dot and dash, and is now a modern
  house (`art/Icons.tsx` `House`; Matt: "change the home logo to be a modern house"): a single-pitch roof with its
  overhang and a door, the icons' wash on its body alone. An active top-bar button is a ring in its own ink rather
  than a solid white fill.
- **The page** (`home/HomeScreen.tsx`) is what a person comes back for: anything waiting on them (update, memo,
  voice model, the Academy), the notes they pinned and the six they were in last as live previews, and every
  unticked to-do from every note (`home/dashboard.ts`), ticked in place by rewriting that one line's box. The
  workspace pills choose what it shows. Every note is a tap away in the sidebar, so the page does not list them all.
- **The notes list is deleted**, with what only it used: its swipe rows (`SwipeRow`, `notes/swipe.ts`), its date
  groups (`notes/groups.ts`) and the empty archive's picture. What it carried that was not the list moved out: the
  notices to `notes/Notices.tsx`, the workspace pills' styles to `notes/WorkspaceBar.module.css`, the glide to the
  top on a workspace change to `core/glideToTop.ts`, and the page's glass bar, scroller and dock to the home page.
- **Left for a decision:** the phone's gist runner (`format/gist.ts`) wrote the line under each row of the list; with
  no list it is never given a note to write for, so it does nothing, but its code is still there.

## 54. A filter on an HTML box, and whose corner it starts from (2026-09-20)

The board lane's foot smoke (`art/wispFoot.ts`) had both of the faults found the same week on the page-level wisps,
and for the same reasons. Measured in Playwright, Chromium and WebKit side by side, on a striped lane 300px tall.

**The placement.** `filter: url(#...)` with `filterUnits="userSpaceOnUse"` does not mean the same thing in the two
engines. Chromium measures user space from the element's own corner. WebKit measures it from the document's corner:
the page's top left, before any page scrolling. A lane places its band at its own foot, so in WebKit the band landed
as far above the foot as the lane sat down the page, and the region - placed in the same frame - stopped covering the
lane at all. Nothing outside a filter's region is drawn, so the cards went with it:

| | band, in rows from the lane's own top | rows of the lane drawn |
| --- | --- | --- |
| Chromium, lane anywhere, any scroll | 272..299 | 136 of 136 |
| WebKit, lane 40px down the page | 232..299 | 134 |
| WebKit, lane 420px down the page | 0..19 | 8 |
| WebKit, lane in a scroller, scrolled | none | 0 |

The page's wisps escape this because `placeRegion` sizes their region to the window from (0, 0), so which corner the
engine starts from makes no difference to them. A lane cannot: its band is somewhere in the middle of the page.

The fix is to stop naming a corner at all. The whole filter is now said in the lane's own box -
`filterUnits="objectBoundingBox"` AND `primitiveUnits="objectBoundingBox"`, every length a fraction of the lane's
width or height - and both engines draw the band at rows 271..299 with every row present, at every scroll position,
in a page and inside a scroller. What that costs is legibility: a length has to be divided by the side it runs
along, a blur needs both of its numbers (one fraction shared between a wide box and a tall one is two different
blurs), and `feDisplacementMap` measures its throw against the box's diagonal over root two.

One attribute must NOT be converted, and converting it shipped a bug. `primitiveUnits="objectBoundingBox"` does not
reach `feTurbulence`'s `baseFrequency`: an engine reads a frequency in the filter's own space whatever the units
attribute says. Converting it with the lengths around it multiplied the frequency by the box, so the noise came out a
couple of hundred times too fine and the smoke read as fine static rather than cloud - Matt, of the tab row's, which
had the same line: "grainy". Measured on bare turbulence at 240x120, neighbouring-pixel difference across and down:
userSpaceOnUse per pixel 1.9 / 5.8, objectBoundingBox per pixel 1.9 / 5.8 - the same cloud, so the units genuinely do
not touch it - and objectBoundingBox times the box 33.6 / 34.7, the static. WebKit gives 1.8 / 5.7, 1.8 / 5.6 and
33.6 / 34.6, so both engines agree and one per-pixel constant serves both.

Worth saying how it got past the first round: the check used to accept the conversion counted mixed pixels per row,
which measures where the band is and how strong it is and is blind to how fine the noise inside it is. The two
filters matched to within 0.2% on that number while looking completely different. The graininess was even visible in
the before-and-after picture taken at the time and was read as the effect working harder. A measurement has to be
able to fail the thing being claimed - the same lesson as the corner probe below, twice in one night.

The subregions stay, converted rather than dropped. Saying it in box units would have been far tidier without them,
and the first draft did exactly that, placing the band with a relative `feOffset` off a region-filling flood so no
absolute coordinate was left anywhere. Measured on two lanes scrolling in headless WebKit, that draft cost 118ms a
frame against 66ms with the subregions kept and 17ms with no filter at all. The subregions are most of what this
effect costs; the shipped filter runs at 67ms.

**The band's geometry**, the same fault the page's foot had at 1.5.0-42. The lip sat in the last 8px of the lane,
inside the 1.2 em mask fade that had already taken the cards to nothing, so the strongest bend happened where there
was nothing left to bend and what showed was a plain dark gradient. The lip now sits `LIFT` = 18px above the foot -
half the page's 36, as this band's lip and ramp are half the page's - so full strength begins 26px up, above where
the fade starts. Measured as smoke surviving above the fade's start: 1921 px of ink before, 6077 after, 3.2x.

The fade is derived from the lip (`WISP_FOOT_FADE` = `BAND + LIFT - 4`, set on the lane as `--cm-lane-fade`) rather
than written beside it. It was `1.2em`, about 20px in a board's type and about 26px at the largest text size - the
width of the whole lip - so the two agreed at one end of the reader's own dial and not at the other, which is the
kind of drift §51's sister lesson is about.

The raised lip raised the floor with it - a lane had to be 106px to carry the band rather than 88, which took the
smoke off boards written `height=6` (about 91px) - and Matt asked for those back: "make them smoke again", with the
ramp shortened to get them. Shortening it for every lane would have paid for the short ones with a tighter, more
abrupt smoke on the tall ones that already look right, so the band is scaled to the lane instead (`fit`): 1 for any
lane with room for the whole band, and below that the lip, the room above it and the ramp shrink together, which
keeps the band's shape and changes only its size. The fade comes down with it, so `WISP_FOOT_FADE` became
`wispFootFade(height)` - a short lane's smaller band needs a shorter fade or the fade swallows it again, on exactly
the lanes this was for.

Measured against the shipped filter at seven heights in both engines: 106px and up come out identical to the
pixel - same band rows, same ink, same fade - and 61, 74 and 91px, which had no smoke at all, now have it. The
floor is 61px rather than the ~74 the change was costed at, and a board cannot be written shorter than `height=5`
anyway. Under it the lane still keeps the plain fade, since a band that small is a hairline standing in for smoke.

**And the corner is worth knowing about on its own.** `art/wispSides.ts` had read the same divergence as WebKit
measuring from the *window's* corner. That is the same corner while the page is at its top, which is where it was
probed, and it is wrong once the page is scrolled. Settled with a filter whose only primitive is a red square at
user space (0, 0) on a box otherwise drawn plain - the output is clipped to the box, so the square only shows where
the origin falls inside it. Chromium drew it at the box's top in every case. WebKit drew it at the box's top for a
box at document y=0 with the page unscrolled, and nowhere at all for that box at document y=300 with the page
scrolled 300, where the window's corner is inside the box and the document's is 300px above. Nothing in wispSides
changed for it at the time - a row at the top of a page that does not scroll sideways has both corners agreeing
across, which is the only direction it placed anything in - but the note was corrected, and the box-units answer here
was the one that filter wanted: it took it the same day, dropped its `left` test and now smokes a row anywhere on the
page (§55).

The budget (`WISP_EDGE_BUDGET`, §51) is untouched and still guards the region. Whether box units change where
WebKit starts painting an over-budget filter black was NOT re-measured - the probe built for it could not reproduce
the black at 2.3x over, so it proved nothing either way - and the guard earns its place on cost regardless.

## 55. The tab row's smoke, in the row's own box (2026-09-20)

`art/wispSides.ts` - the wisp on the tab row's open ends (`notes/NoteTabs.tsx`) - was the last filter still placed in
user space, and it carried two workarounds for the corner divergence §54 settled. Both are gone: the whole filter is
now said in the row's own box, `filterUnits="objectBoundingBox"` AND `primitiveUnits="objectBoundingBox"`, exactly as
the lane's foot is.

**What it used to do instead.** It could not place anything vertically, so it placed everything everywhere: the region,
the bands and the noise all ran `REACH` = 400px above and below the row, wide enough that whichever corner an engine
started from fell inside them. And across it simply refused the job - `wispSides` took the row's `left` and returned
null unless the row began within a pixel of the page's own left edge, the one place the two frames agree across. A row
anywhere else kept a plain fade.

Neither held up. Measured in Playwright on a striped row 600x57 with both ends open, counting columns of the row that
were drawn at all and where the stripes were bent:

| row's place | before, Chromium | before, WebKit | after, both |
| --- | --- | --- | --- |
| page top, unscrolled | bands at 0..48 / 551..599 | same, 0..47 / 552..599 | same |
| in a scroller, 200px down | bands, 600 of 600 columns | bands, 600 columns | same |
| 900px down, page scrolled 700 | bands, 600 columns | **nothing drawn at all** | bands, 600 columns |
| 900px down, page scrolled 900 | bands, 600 columns | **nothing drawn at all** | bands, 600 columns |
| 300px in from the page's left | **no filter** (the `left` test) | **no filter** | bands, 600 columns |

The 400px reach was never a fix, only a reprieve: it bought exactly 400px of page, and a tab row 900px down a scrolled
document is past it, so WebKit's region stopped covering the row and the tabs went with it. In the row's own box there
is no corner to pick and no distance to outrun. WebKit now matches Chromium to within the one column of antialiasing
it always differed by.

**That table is also where this section got something badly wrong, so read the metric before trusting it.** It counts
columns in which the stripes are no longer pure - where the bend touched them - and by that measure Chromium went
from 5579 px of bent ink to 5582, which was written up here as the conversion leaving the appearance untouched. It
was not. A count of bent pixels cannot tell soft smoke from fine static: both bend nearly every pixel in the band,
and both score the same. The `baseFrequency` conversion below had in fact turned the smoke to grain, the shipped
bundle carried it for nine builds, and the person who caught it was Matt, looking at his tabs. A measurement that
cannot fail in the way the thing itself fails is not evidence, however precise the number it prints.

**The reach could then go.** With the frames agreed, the region only has to hold what the bend can throw, so it is
`SIDE` = 24px on all four sides like any other margin, not 400 above and below. That takes the region from 648x857 to
648x105, an eighth of the pixels, and the filter's cost with it. Six rows scrolling at once in headless WebKit: 131.3ms
a frame before, 29.7ms after, against a 16.7ms floor with no filter at all - the effect's own cost falling from 114.6ms
to 13.0ms, which tracks the area almost exactly. Two rows, the ordinary case, went from 42.4ms to sitting on the vsync
floor. The same shrink relaxes `WISP_EDGE_BUDGET`'s guard, which is counted on the region: a row has to be far larger
now before it gives up and keeps the fade.

**The subregions stayed, converted rather than dropped**, on §54's measurement - they are most of what the effect
costs, and taking them off the lane's filter nearly doubled its cost a frame. So the conversion is the fiddly kind: a
length divided by the side of the row it runs along (`box`), both numbers on every `feGaussianBlur` and `feMorphology`
- one fraction shared between a wide row and a short one is two different blurs - and `feDisplacementMap`'s throw
divided by the box's diagonal over root two (`corner`).

**One attribute must NOT be converted, and converting it is the bug above.** `feTurbulence`'s `baseFrequency` is read
in the filter's own user space whatever `primitiveUnits` says, so multiplying it by the box's sides asked for 26
cycles across a 375px row where 0.07 a pixel was meant - noise hundreds of times too fine, and a displacement map fed
fine noise bends every pixel on its own account: grain, not smoke. It stays per pixel, as every other wisp in the app
writes it (`art/wispEdge.ts`, `wispFormat.ts`). Settled by drawing three strips 375x41 side by side from the one seed
- per-pixel in user space, the same numbers in box units, and the multiplied pair - where the first two are the same
soft cloud and the third is static. `art/wispFoot.ts` carried the same line from §54 and was grainy the same way.

**And the tabs gained a layout they never had.** Dropping the `left` test means a row inset from the page's edge
smokes: checked on the real row pushed 243px in, both ends dissolving where before it wore a plain fade. Nothing in
today's layout puts it there - the row still starts at the page's left edge - so nothing changes on screen for now,
but the effect no longer has an opinion about where the row is allowed to sit.

## 56. A canvas edited (2026-09-20)

Matt: "continue progress on canvases, ship what we have so far". The first slice read and drew an Obsidian canvas;
this one changes it (`canvas/CanvasView.tsx`, `canvas/jsonCanvas.ts`).

- **The gestures the app already has.** Only one of them was Matt's choice - a double-tap on the page makes a card
  of words there, keyboard up (docs/CANVAS.md, choice 8). Moving, opening and taking off were never put to him, so
  they follow habits the app already teaches: a press held on a card lifts it, as a board's card and a tab are
  lifted, and a plain drag pans; a double-tap on a card of words opens it, since a single tap already opens a note
  card or a link card and a double-tap is what a single tap cannot mean; a card open to be written in wears a cross
  that takes it off, lines and all. His to change, and the doc says which are his and which are not.
- **The canvas is what is handed back.** Every change is the whole canvas through `onChange`; the note writes it
  into its body as the spec's JSON with the front matter kept (`withCanvas`), through the same debounce and flushes
  typing has. A card mid-drag lives in the view's own copy (`live`) until it is put down, so the lines follow the
  finger without a save per frame. Positions are rounded to the pixel, as the spec keeps them.
- **The editor once, two ways.** A card of words is the note's editor in peek mode until it is opened, and the same
  editor in the note's own mode while it is; the read-only one is only made near the screen (`Near`), the open one
  at once, and the keyboard is asked for a tick after it mounts.
- **Lines, by two taps.** The third slice: the Line tool makes the next two taps a line, from the first card to the
  second; a tap on a line picks it, and a picked line shows its words and a cross. A tool rather than Obsidian's
  drag from an edge dot, since a finger has no hover to find a dot by. The browser caught what the tests could not:
  in Line mode a tap on a link card ran the card's own handler first and the page left for the address, so Line
  mode is handled in the capture phase, before any card sees the tap.
- **Sizes and groups.** The fourth slice: an open card's corner resizes it, no smaller than a word and a cross; a
  held press on a group lifts it with everything wholly inside it, measured as Obsidian measures it, so a card
  half over the edge stays; a double-tap names a group, and its cross takes the group off and leaves the cards. A
  drag is measured from the canvas as it was at pick-up (`carrying.base`), not from the last frame, so a group and
  its cards move by one amount rather than compounding.
- **More ways in, and the way around.** The fifth and sixth slices: the + is a sheet in the home +'s own look (words,
  a note by its title, a web address), a sidebar row dragged onto the canvas is a card of that note, a card's title
  zooms to it, Shift+1 and Shift+2 do what Obsidian's do, and a minimap draws the cards with the screen's box over
  them. The view lives in a ref so a pan is one style write; the minimap needs it as state, so `apply` mirrors it
  once a frame at most.
- **Pictures, charts, tables, and a toolbar of icons.** The seventh slice: a picture card is the spec's file node
  named by the picture store's own name, so it syncs with the notes' pictures and a vault's picture (a folder in its
  name) is told apart; a chart is a card of words that starts as Mermaid, with the editor's diagrams let through on a
  peek by a `diagrams` prop rather than a second mode; the tools moved to a floating pill of icons at the bottom left
  (Matt: "use iconography instead of text") with the map at the bottom right, and what a line needs next is said
  beside them.
- **The map, redone; a table to the edges.** The minimap tells the kinds of card apart, draws the lines between
  the sides they use, names groups when there is room, wears each card's hue and keeps the canvas's shape centred;
  a drag on it pans. `setPointerCapture` is guarded: a browser throws for a pointer it is not tracking, and the press
  must still go where it landed. A card that is only a table (`isOnlyTable`) loses its padding and the table takes
  the card, edge to edge.
- **The example canvas has one of everything.** "Make an example canvas with images, charts, tables, notes and lines
  linking": Settings > About now lays out a group, cards of words, the example board and the sample note as cards,
  a link, a chart, a table and a picture, with words on the lines between them. The picture is the sample note's
  drawing, made and kept by the picture store as the canvas is added, and left out where nothing can draw it, so
  the canvas is whole in a test and on a phone alike.
- **The map grown, and the screen dragged across it.** "Make the minimap a bit bigger when we click on it and allow
  clicking and dragging to navigate around the canvas": a press grows the map half again (`data-big`, sized by CSS
  with a short transition) and it stays grown until a press lands on the canvas. A drag on it moves the screen's box
  by what the finger moved, so the view goes with the finger and nothing jumps under it; a tap on the grown map
  goes to the spot tapped, while the tap that grew it only grew it. The map is drawn in one `viewBox` whatever its
  size on the page, and a finger's place on it is read from the rendered size at that moment, so a press mid-growth,
  or on a phone where the map is scaled down, still lands where it points.
- **Measured in the browser, not assumed:** a held press of 300ms lifted the card and a move of (60, 90) screen
  pixels at scale 1 put it down at (60, 90); a double-tap made a card with a sixteen-hex id, focused, and what was
  typed was in the saved note with its front matter untouched. In the tests, a move before the hold pans and saves
  nothing.

## 57. The wide window's bar is glass (2026-09-20)

Matt, of the Mac app: "the top header is missing the glass effect, it's showing at the very top but the tabs and
such are fully opaque." The very top is the title strip, 44px under the window's own buttons, and it was glass; the
bar under it was not.

- **What painted it.** On a window wide enough for the notes to sit beside a note, App.tsx stamps `data-split` and
  app.css gave the tab bar a ground of solid paper across the whole window - asked for earlier ("the tabbar should go
  across 100% of the screen even on widescreen"), because the transparent bar over two panes read as though it
  stopped at the divider. Solid was the easy way to make it one bar; it also made it the one opaque thing on a page
  of glass. A phone never had the rule, so the phone kept its glass and the desktop lost it.
- **Glass across the window instead.** The bar now wears the header pane's own mix and blur (`.app-headerPane`),
  so it is still one bar from edge to edge and the cards scrolled under it show through it as they do under the
  title strip. Under it, the note pane's own header pane tints only from the bar's foot down (a gradient that starts
  at `--app-safe-top`), so the bar's tint is not laid on the pane's: two tints would have made the note's side of the
  divider darker than the sidebar's. Blur laid on blur looks the same as blur, so the pane keeps its own.
- **Measured at 1280px with the home page scrolled 226px under the bar:** the bar's ground came out
  `color(srgb 0.017 0.017 0.017 / 0.66)` with `blur(18px) saturate(1.1)`, the pane's a gradient from transparent
  at the bar's foot, and the cards read through both.

## 58. The smoke bench (2026-09-20)

Matt, of the Mac app: "the desktop app is incredibly laggy", and once the cost was found, "can we fix the wisp
animation to be more performant?" The cost is the wisp edge's filter in WKWebView (54 above; art/wispEdge.ts), and
the answer being built is the same smoke as a mask (art/wispMask.ts) behind a switch on the hook. What was missing
was a way to see the two against each other with their cost on the same screen, rather than in numbers relayed
from a hand-built rig through three sessions.

- **Settings › Developer › Smoke bench** (settings/WispBench.tsx): a page over settings with one scrolling surface
  wearing the hook with `draw: 'filter'`, `draw: 'mask'`, or no hook at all - the app's own hook and its own
  switch, so what a surface wears here is exactly what a note would wear. A frame counter sits in the surface's
  header (the last 120 frames: median, p90, worst, written twice a second from the header, which is over the page
  and not in it, so the writing is not a repaint of the thing being measured). Scroll by hand and read it.
- **The run** drives the surface the three ways the rig did - left alone, one repaint a frame (a mark in the
  scroller with its opacity toggled), scrolling (three pixels a frame, back and forth, never back to the top so the
  header band stays on) - for each drawing in turn, and prints n, median, p90 and worst per cell. Two rules from
  the rig are the clock's (diag/frameClock.ts): a cell ends on the wall clock as well as its frame count and says
  how many frames it got (a four-second cap on a three-second frame gave one frame and no median), and the p90
  stands beside the median (3157ms median against 6507 p90 is what "laggy" feels like). Quick: 180 frames or 8s
  a cell; long: 30s.
- **One surface while measuring.** A frame's length is the page's, so three surfaces would add up. Side by side
  draws all three for looking and says so; a run puts the page back to one. What each cell's surface wore is read
  off the element (`data-wisp-edge`, `data-wisp-foot`, `data-wisp-draw`, the computed filter), not assumed from the
  switch, and is in the row. Copy as text gives the table tab-separated under where it ran (version, app or
  browser, engine, window).
- **The whole app, one way.** A line on the page writes the hook's own override (`glyph-wisp-draw` in
  localStorage) so the app can be flipped to the mask or the filter from its next start and felt, not just read;
  and taken back. "No smoke" is not a thing the app can be told to draw.
- **What the pane's numbers are not.** In the desktop app's browser pane the counter read 1000ms flat: that pane's
  requestAnimationFrame is throttled to once a second while it is not the front window, so nothing read there is
  about any engine. jsdom's frames say nothing either, and the tests do not read them as if they did. The number
  that counts is the one on the Mac app's own screen, which is what the page is for.

## 59. The smoke as a mask, for the engine that cannot afford the filter (2026-09-21)

Matt, of the Mac app: "desktop is still very laggy, can we fix the wisp animation to be more performant?" - the
direction being make it cheap, not turn it off. The measurement (58 above, the lane session's, in the real
WKWebView): free at rest, 585-690ms for one repaint with one band's filter, over four seconds a frame scrolling with
both, against 16-18ms with the filter off; the same page in GPU Chromium at 16.7ms whatever the filter does.

- **Why the filter cannot be made cheap there.** WebKit renders the whole element that wears `filter: url()` into
  a buffer and pushes it through the graph on every repaint, however small the primitives' subregions are; a
  scrolling page repaints every frame. Tightening the subregions changes nothing about that. Moving the filter
  onto a thin band at the header's edge would need `backdrop-filter: url()`, which WebKit does not take (its
  backdrop-filter is the CSS functions only), so a band could only bend a copy of the words - a second DOM of the
  note's top edge, kept in step. Not that.
- **The mask instead** (art/wispMask.ts). The band's shape is made once, as an image: the same turbulence the
  filter uses, `stitchTiles` so it tiles along the edge, over the same soft ramp the filter blurs from its strip
  (a grey strip above the lip on white, `feGaussianBlur` down it), the noise added by arithmetic, the red channel
  taken to alpha and pushed through a steep `feComponentTransfer` table so it tears the words into tendrils rather
  than misting them. The foot is the same picture turned over, with its taller ramp. An image used as
  `mask-image` is rasterised one time and cached; a mask composites on the GPU; nothing is re-rendered when the
  page scrolls under it. The scroller's mask gains a layer per band, added to the ramp gradient it already wore
  (`mask-composite: add`), laid from `--wisp-lip` (the hook writes it: the header's height and the drop) with
  `--wisp-mask-above` of smoke over the lip to reach the top of any header. The drift is the same clock writing
  `--wisp-noise-x/y` into `mask-position` - on the views wearing the mask, not on the root, where a custom property
  written thirty-five times a second invalidates style for the whole document whatever the mask costs (the lanes
  session's point, before any measurement). `filter: none` in that mode: the graph never runs.
- **What it loses and keeps.** The bend: the letters dissolve through the smoke instead of being pulled into it.
  Kept: the smoke, its movement with the scroll, both ends, and the engines drawing the one page the same way.
- **A switch, not a replacement.** `useWispEdge(..., { draw: 'filter' | 'mask' })`; left out, the platform decides
  (the mask in the Mac app, `data-titlebar='overlay'`; the filter elsewhere, where the phone's GPU draws the bend
  for nothing), and `glyph-wisp-draw` in localStorage overrides it for anyone comparing. The view says which it
  wears (`data-wisp-draw`), so the bench (58) and the stylesheet can tell. The lane session's caution stands until
  measured: a `mask-position` that changes every frame is a property change on the masked element, and if WebKit
  re-composites for it the fallback is a fixed band with the drift dropped on the Mac, which the switch allows.
- **Found on the way.** The two modules import each other, and two constants read wispEdge's numbers at
  wispMask's top level: whichever module was entered first, the other's top level ran in the first's temporal dead
  zone, and every page importing the editor failed to load. Nothing at the top level now reads across the cycle.
  And a deploy was refused with every test green: a CodeMirror measure on the animation clock, firing after a
  doneSync test, hit jsdom's missing `Range.getClientRects`, and Vitest exits 1 on an unhandled error. Every test
  now gets the stub (src/test/setup.ts) that images.test.ts had for itself. And three first-in-file tests that mount
  an editor - a cold CodeMirror render, about four seconds idle - timed out at Vitest's five while a second suite ran
  on the machine, and refused a deploy the same way. The ceiling is twenty seconds now (vitest.config.ts). Re-proven
  after 1.5.0-68 on the same Mac by the fork session: the same three first-in-file renders took 8.2, 10.0 and 10.1
  seconds under twelve yes-hogs and passed at the 15s ceiling it had then - by a third, which is why it is twenty.
  A hang still fails at twenty.
- **Seen at 1280px in Chromium with the override:** the note's page wore `data-wisp-draw="mask"`, `filter: none`,
  three mask layers `add`ed, the lip at 130px under a 112px bar, and a heading at the lip dissolved through the
  smoke while the lines under it stood whole.

## 60. The workspace, on the note (2026-09-21)

Matt: "please show the workspace on the view that shows the note itself." The home page said which workspace a
note was in and the note did not, so a note opened from a tab, a search or a canvas card gave no sign of where it
lived; the only place that said so was the cog, a tap away.

- **In the link row.** The note already wore a row under its tape for what it is tied to (plugins/LinkMarks.tsx: a
  Notion board, a repo), and a tap on that row opens the cog, which is also where a note is filed. The workspace
  goes first in that row, as the pill the home page draws it with (notes/WorkspaceBar.module.css `.space`) in the
  workspace's own hue, at the row's size so it sits level with the marks. The row now shows for a filed note with
  no links too; a note in no workspace with no links wears nothing, as before. The list's compact row keeps the
  marks alone: it has its own place for a workspace.
- **Read through the store's hook**, so filing the note from the cog, or recolouring the workspace, redraws the
  pill without the note re-rendering for anything else. The tap's label says both: "In the workspace Cabin. Linked
  to Notion Weekend. Change in this note's settings."

## 61. The Mac window opens as a desktop window (2026-09-21)

Matt: "make the desktop version of the app open in a desktop resolution, right now it opens in a portrait layout."
One `tauri.conf.json` served every platform, and its window was a phone's: 430 x 860. The phone never reads that
block (Android and iOS take the screen), so the only thing it ever shaped was the Mac app, which opened as a tall
strip with the phone layout inside it and had to be dragged wide before the sidebar appeared.

- **1280 x 820, centred** (`src-tauri/tauri.conf.json`): wide enough for the split at once - the sidebar wants 660px
  and a mouse (core/useWideScreen.ts) - and inside a 13-inch laptop's screen with room around it. At two device
  pixels to the point that is 4.2M, still far under the filter region's 2^24 budget (54 above).
- **The minimums stay** at 360 x 560: a window dragged narrow gets the phone layout on purpose, which is how the
  phone's shape is checked on a Mac.
- **Not remembered between launches.** Tauri does not restore a window's last size and place on its own; every
  launch opens at 1280 x 820 in the middle of the screen. Remembering would be the window-state plugin, a Rust
  dependency and a capability, not a number - left for when it is asked for.
- **Reaches the Mac only as a new build.** A window's size is the app's, not the web bundle's, so no over-the-air
  update carries it: it ships as a signed universal Mac build (`deploy-ota.mjs --desktop`), downloaded from
  attack.fm/glyph.

## 62. Lines kept apart, labels kept off the cards (2026-09-21)

Matt, with a screenshot of the HelloTrade canvas: "No two arrows should render pointing too close as they look
joined like a diamond. Secondly the text that's on arrow paths sometimes overlaps content and we can't read the boxes
below." Both were the geometry's: every line end sat at the exact middle of its side, and every label at the exact
middle of its curve, whatever else was there.

- **The diamond.** Two lines into the facing sides of neighbouring cards land at the same height, their heads base
  to base in the gap between - one shape with a point at each end. Lines are now drawn together rather than one by one
  (`edgePaths` in canvas/jsonCanvas.ts): ends that share a side of a card are set along it, `END_SPREAD` (28px)
  apart, in the order their far ends come so the lines leave without crossing; and two heads on different cards
  nearer each other than `HEAD_CLEAR` (56px, three heads' lengths) are moved apart along their own sides until they
  are that far apart, each going away from the other along the side's axis, or when level, the one whose line comes
  from further along that axis going that way. An end keeps 16px from its side's corners. Alone, a line lands on the
  middle as before.
- **The label.** It tries the curve's middle and then either way from it, in steps of a twentieth, and takes the
  first point where its box (about 6.8px a letter at the label's 13px, 20px tall) is over open canvas and not over
  a card. A group is open canvas. Where one line fits nowhere it is broken onto two, then three, and the tries run
  again, so words longer than the gap between two cards fit down it (the example canvas's "every mark a note can
  hold", 26 letters between two cards 120px apart, goes on two). Where nothing fits anywhere it sits in the middle
  on one line as before and the halo does what it can.
- **Measured in the tests with the screenshot's shape:** two cards 40px apart, a line into each from above, tips at
  (300, 100) and (340, 100) before, 56px apart after with each still on its own side; two lines into one side
  landing 14px either side of its middle; a label on a straight line over a third card moved to the first clear
  stretch, left on a group, and back at the middle under a card the length of the line.

## 63. The app is Ghost.md (2026-09-21)

Matt: "rename the app from Glyph to 'Ghost.md' since we got that domain name." The rule the rename follows, so the
next person knows what was and was not meant to move:

- **What a person sees is Ghost.md.** Every line of copy in the app (the guide, About, notices, the palette, the
  plugins' pages and their authors, the AI prompts' "inside Ghost.md, a notes app"), the page's title, Tauri's
  `productName` and window title (so the Mac app is Ghost.md.app and the Android launcher says Ghost.md), the
  download pages, the MCP sign-in page and tool words, the sync service's Notion pages, the README. The two example
  canvases and the sample note say it too.
- **What a machine relies on stays.** The bundle and package ids (`com.mattssoftware.glyph`), every localStorage key
  (`glyph-developer`, `glyph-wisp-draw`, ...), the sync salt `glyph/v1/<handle>` (changing it would change every
  account's keys), the `glyph1.` token prefix, the attack.fm/glyph paths and API bases (they move with the domain,
  separately), file and script names, the repo and package name, the design log's history and its quotes.
- **The spoken word is "Ghost".** Nobody will say "dot md" to a phone, so the address a command follows is the short
  name: "Ghost, add a table to this note". The recogniser (capture/command.ts `findKeyword`) accepts "ghost" and what
  speech recognition writes for it beside "glyph" and its own mishearings, so the old word still works and the
  recorded voice suite still passes. Not accepted: "coast" - a mishearing tried and dropped the moment "Packing for
  the coast" lost its last word. Two things worth Matt's eye: "ghost" is a commoner word than "glyph" was, so a
  sentence that starts with it and is not a command will now draw the "no command there, the words stay" notice
  where it did not before; and the Android settings path the guide walks ("Digital assistant app › Ghost.md") says
  the new label before the phone shows it, until the next APK.
- **Reaches the phone and the Mac only as new builds** for the label and the bundle name; the copy goes over the
  air.

## 64. The ghost in the empty places (2026-09-22)

Matt, with the dotwork scenes generated: "process them to be smaller sizes and then wire them all and ship an OTA
update" (docs/GHOSTS.md has the prompts and the table of where each went).

- **One file for both themes.** The pictures are black dots on white. A plain image would have stayed black on the
  dark theme, whose paper is black, and a second dark set would be fourteen more files to keep in step. Instead
  each picture is a mask - the dots are its alpha - and `art/Ghost.tsx` paints a square of `currentColor` through
  it, so the ghost takes the page's ink like the words do: black dots on the light page, white on the dark, in
  `--app-ink-3` by default. Seen in the browser in both themes.
- **Small enough to ship over the air.** 2048px PNGs of 2-4 MB became 600px WebP masks of 28-55 KB (sharp at 200px
  on a 3x screen), 608 KB for all fourteen, imported through Vite so each is hashed and cached like the code.
- **Three sizes**: 12.5rem where the picture leads a page (the empty home page), 7.5rem beside words - the abstract
  shapes' size - and 4.5rem inside a card. Each drifts up and back slowly with long rests, a transform, and holds
  still under reduced motion.
- **Twelve places, and two scenes with none.** Where a page already had words for the moment the ghost sits over
  them; the trash and archive are only shown when they hold something, so their scenes wait for a page, and the app
  has no error screen for "something went wrong". A new note shows its ghost under the first line - over the
  editor, not after it, because the editor grows to fill the page and after it the ghost sat at the foot of the
  screen - and it goes at the first word and comes back if the note is emptied.
- **"Every to-do is done"** needs to know there were to-dos: `tickedTasks` counts the ticked ones (outside code
  fences and the archive), so a page that never had any says nothing.
- **Then twice the size each way** (Matt: "the graphics are too small they should take up at least 4x more space"):
  25rem leading a page, 15rem beside words, 9rem in a card, each capped at its column so a phone's leading ghost
  fills the page's width (331px at 375) rather than overflowing. The masks were remade at 1024px so they stay sharp
  at that size on a 3x screen: 2.0 MB for all fourteen. At 400px the empty home page's stack put "A blank page." at
  the foot of a laptop screen, under the foot's smoke, so where the page is wider than 44rem the ghost and its
  words sit side by side (a container query on the home page's column).

## 65. A quieter guide, and a note that teaches formatting (2026-09-22)

Three asks in a row from Matt.

- **"remove the ghost icon from the welcome page."** The welcome page opens on its headline and its gags again; the
  ghost stays everywhere else it was placed (docs/GHOSTS.md).
- **"on the theme page remove the effect that flicks it on and off and whatnot automatically it's annoying."** The
  page flicked the whole theme light and dark four times by itself, to show there was a choice (GloveSwitch, and the
  code that put the theme back if the person left without choosing). All of it is gone, file and all: the page is
  still until a choice is tapped, and its line says "Pick one to see it. You can change it later in Settings."
- **"remove the step showing markdown and instead just replace the 'everything a note can hold' as a short tutorial
  for formatting everything."** The guide's Markdown step ("The marks, and how to say them") is taken out, so the
  guide is six pages; its cheat sheet page ("Every mark, side by side", which Settings opens directly) stays. The
  sample note is now "How to format a note": for each mark, how to type it, the word to say for it while recording,
  and one example, short, ending with press-and-hold Style. It still holds one of every mark the editor draws - its
  test says so - so it is still the note that shows everything, only now in the order a person learns it.

## 66. The strip behind the clock is the bar (2026-09-22)

Matt, of the Fold's inner screen: "The very top bar where the time and battery and stuff show up still has the
missing semiopaque black background like the rest of the headers have so it looks different." Two sessions had read
the strip as the activity's window background - the page not drawn under the status bar - and the Android 16
emulator, which draws the page under the bar, did not reproduce it. The second screenshot did what the first could
not: the strip had a soft light gradient in it, which is what blurred, untinted cards look like. The page was under
the bar all along; the strip was missing the tint.

- **Why only there.** On a phone the screen's header pane covers the strip, tint and blur, from the top. On the split
  layout (`data-split`, which the Fold's inner screen is: wide and tall) the tab bar is glass of its own across the
  window and began at `--app-inset-top`, under the status bar, while the pane's tint below it starts where the bar
  ends (`--app-safe-top`) so the two would not stack. Between the screen's edge and the bar's top nobody tinted: the
  pane's blur reached it, its tint did not, and the scrolled cards showed through lighter than through the bar - a
  grey gradient over a black bar. The Mac's 44px title strip is the same case.
- **The bar reaches the top.** `:root[data-split] .app-tabBar` now starts at 0 and pads down by the inset, its height
  grown by the same, so the strip is the bar: one glass from the screen's edge to the bar's line. Its bottom edge,
  `--app-safe-top` and the pane's gradient are as they were, so nothing under it moves; the Mac's drag bar (z 41)
  still sits over it (z 5). Measured in the pane at 1024px with a 40px inset forced and the home scrolled under the
  bar: bar top 40 and height 108 before, top 0 and height 148 after, the row's top at 50 (inset plus the bar's own
  inset) either way.
- **What was learned about measuring.** A pixel average of a JPEG told two people "nothing the page paints" when the
  strip was the page's own blur without its tint; the emulator told the truth about where the page was and nothing
  about how it was tinted. The picture that settled it was the one with a gradient in it. A Developer › Window
  section (§ above) now says the inset the page is given, so the first question - is the page under the bar - has a
  number next time.

## 67. The ghost, still, and as big as the room (2026-09-22)

Matt: "I want the ghost pictures not to float and also they can be larger even still, try to fill 100% width or
available height without going too big."

- **Still.** The slow drift up and back is gone, keyframes and all (art/Ghost.module.css).
- **As big as the room, within limits.** A ghost beside words is the column's whole width, up to 40% of the window's
  height and 28rem; one leading a page up to 60% of the height and 36rem; the one in the update card stays 9rem, since
  filling the card would push its words out. Measured at 1280x800: the empty home page's ghost 480px (60% of 800)
  beside its words, the sidebar's 320px in a 337px column, a new note's and an empty canvas's 320px. At 375x812 a new
  note's is 325px of the page's 331, nothing wider than the screen.
- **Two places needed a definite size to be a share of.** The wide home page's side-by-side grid had an auto column
  sized by the ghost, and a width of 100% of that is circular; it is now three parts to the words' two. The empty
  canvas centres its ghost in a grid sized by its content, so its ghost is sized by the screen instead.

## 68. The ghosts cropped to their drawings, and a small one in the update card (2026-09-22)

Matt: "Trim all the white space from around the images we recently added and make the one on the update banner
smaller as right now it makes the update banner huge."

- **Cropped.** Each picture was a square with the drawing in its middle. Now each is cut to its drawing with a 2%
  edge so no dot is lost, remade from the original at 1024px on its long side (2.6 MB for all fourteen). None is
  square any more - from 0.29 wide per unit of height (the trash) to 1.47 (the empty canvas) - so each ghost's box
  takes its picture's shape (`GHOST_RATIOS` in art/ghosts.ts, `--ghost-ratio`), and the limits on height are limits on
  the drawing: a ghost is its column's width, up to 28rem, and up to 40% of the window's height.
- **The update card's ghost is 3rem tall**, about two lines of the card's words: 36 by 48px, and the card 84px tall,
  measured with the real card mounted in the browser. At 9rem wide it had made the card as tall as the ghost.
- **The home page, measured after cropping.** A cropped ghost fills its box, so the old limit put the empty home page's
  ghost behind the dock's buttons on a laptop (its foot at 777px, the dock at 738 in an 800px window), and on a phone
  put the second line of words under the dock. Leading a page it is now up to 45% of the height beside its words and
  38% stacked over them: 360px tall ending at 657 on a laptop, 309px ending at 590 on a phone, the words clear of the
  dock on both.

## 69. Faster: note previews built once, rows that stay put, settings parsed once (2026-09-22)

Matt: "Go through the app and investigate how we can get better performance on desktop and mobile check for render
storms and others", then "Do it". Measured before touching anything, in headless Chromium with 150 notes, with
counters installed before React (commits, what rendered and where each render began, frames, timers, listeners,
observers, long tasks, localStorage reads and JSON parses), on the dev build and the production build, at a laptop's
width and at a phone's with the CPU slowed four times.

- **What was fine.** No render storm across the app. Idle does nothing: no commits, no animation-frame loops, no
  polling but the five-minute sync. Typing in a note's body is four commits for forty-one keys; scrolling a note two.
- **Note previews were editors, built again every time.** Each card on the home page and each of the sidebar's rows
  is the note's own editor, read-only (notes/NotePeek.tsx), mounted as it neared the screen and torn down as it left.
  One scroll down a 150-note sidebar built 276 editors, 5.4 s of CPU in the dev build, with long tasks of 51-71 ms;
  going home built the home cards' again, three long tasks of about 80 ms. Now a card keeps what its editor drew -
  its HTML, for that text in that theme - and lets the editor go: any card of the same text comes back drawn, with no
  editor, and the formatter is the note's own as before, run once per note per session. After: going home builds
  none (one long task of 54 ms, from three), scrolling home has none (from three), the first scroll down the sidebar
  three of at most 55 ms (from nine to thirteen, up to 76); every later scroll builds none. Every card watches the
  screen through one shared observer, not one each (156 before).
- **The sidebar re-rendered every row whenever the app shell did.** Opening a note rendered the shell three times and
  each time all 150 previews, 450 renders; typing in a note's title did it every keystroke. The preview is memoized
  (its props are two strings), so a row whose note has not changed is skipped: opening a note now renders none of
  them.
- **Settings parsed on hot paths.** The Notion and GitHub links were read and parsed on every keystroke through the
  plugins' suggestions, and four plugin keys on every render of a note: about a hundred parses for forty-one keys.
  The home page parsed the whole AI-results sheet once per card, 24 times. Both now keep what they parsed with the
  text it came from (plugins/host.ts, format/results.ts): a read still asks localStorage for the text, which cannot
  be stale however the key was written, and parses only when it has changed. The value is shared, so the four places
  that changed what they read - linking a board, linking or removing a project, keeping an AI result - copy it first.
  After: four parses for forty-one keys.
- **Not done, and why.** The main bundle is 2.54 MB (757 KB gzipped) and loads whole; splitting out the guide,
  settings, canvas and recorder is a larger change, left for its own pass. The Mac app's WebKit was not measured -
  control of the app was not given and it was not used while a watcher sampled it - so what WebKit alone makes costly
  (the smoke, the stacked glass) is still to be read on the Mac, from Settings > Developer > Smoke bench. Headless
  Chromium draws a frame only every few hundred ms, so key-to-paint latency was not measured either.

## 70. Books: notes in an order, with an index (2026-09-22)

Matt: "add a Book feature it should be a collection of organized notes with an index." Built the way boards and
canvases were: a book is a note, its index is its body, and Markdown anywhere reads it (docs/BOOKS.md).

- **The shape.** One line of front matter, `book: true`, makes a note a book; the `title:` names it as a canvas is
  named. The body is a list of `[[links]]` to the chapters in order, a chapter indented under the one before being a
  part's chapter (2.1). The book's own words - a paragraph before the list - stay and show over the index. A chapter
  is any note, found by its title; a title with no note is a chapter still to be written, and opening it makes the
  note the way opening any `[[link]]` does.
- **Drawn as its index** (book/BookView.tsx) where the note's words would be, the Markdown a toggle away in the
  header, exactly as a canvas's JSON is - the same switch, the same rename from a tab's menu, the same write through
  `onChange` on typing's debounce, so the index behind the view and the view are one thing. Rows open chapters; each
  moves a place up or down or comes out of the book, and no edit touches a chapter's own note. Two ways in: a
  chapter named here and opened at once, or a note already written, picked from the library's titles less the
  book's own and those in it.
- **A chapter wears its book** (BookBar under the link marks): the book's title, the place (2 of 5), the neighbours
  either side. Found by title (`bookOf`): the first book in the library whose index names the note; a note in two
  books shows the first.
- **The + makes one** (notes/NewSheet.tsx): "New book", empty, opened on its index.
- **Decided without asking, said here so it can be undone:** the index is a list in a note rather than a folder or
  a kind of its own (a folder cannot hold an order or a preface, and a note syncs, links and opens everywhere a
  note does); one level of parts; rows move a place at a time rather than by drag; no reading-through view yet.
  Not built: reading a book straight through as one page, making one by voice, a book mark in the list.
- **Seen in the pane:** a book from the +, its empty index; "First steps" added by name, the chapter opened wearing
  "New book · 1 of 1"; the book opened from the bar with the row in it. 16 tests of the model and the view; the
  suite 1115 green.

## 71. The scrollbar starts under the header, not behind it (2026-09-22)

Matt: "On the home page the scrollbar goes behind the header."

- The home page's list, like a note's page, runs the whole height of the window so its words can pass under the
  header's glass, and its scrollbar ran with it, from the window's top edge, under the blur.
- The hook that already measures the header for every such view (art/wispEdge.ts, `--wisp-under`) now marks the view
  `data-under-header`, and one rule in app.css starts that view's scrollbar track where the header ends: a slim rounded
  thumb in the page's ink on no track. Measured at 1280x800: the home page's header ends at 73px and so does the top of
  its scrollbar's track.
- Only where there is a pointer (`hover: hover` and `pointer: fine`): styling a scrollbar gives up the platform's own,
  and on a phone the thin one that shows only while scrolling is the right one. Chromium and WebKit both take the
  track's margin; checked in Chromium, and the Mac app's WebKit reads the same rule.

## 72. A book made from the +, with its pages picked; a Library on the home page (2026-09-22)

Matt: "Expand in the UI/UX for creating books allow choosing existing notes as pages etc etc and make a library
section on the home dashboard for books." The first slice (§70) made an empty book and left the pages to its index;
this is the front door.

- **The New book sheet** (book/NewBookSheet.tsx), in the New sheet's own shell: the name, then the library's notes
  under a search, each a row that ticks - a tap puts a note in the book, a second takes it out - with the pages so
  far listed above in the order they were tapped, each movable a place or left out. *Make the book* writes one note
  with that index (`bookNoteBody(title, pages)`) and opens it; closing the sheet writes nothing. Books are not
  offered as pages: a book of books is a thing for another day.
- **The index picks several at once.** *Add a note you have* on a book's index now ticks any number and adds them
  in the order ticked, the same rows as the sheet's.
- **The Library** on the home page (home/HomeScreen.tsx, `bookNotes` in home/dashboard.ts): between Pinned and
  Recent, a card per book - its name, "3 pages", the first four as a small numbered index, when it was last
  touched - a tap opening the index. A book is no longer also a Recent card, so nothing shows twice; the archive
  stays out, as everywhere on the page.
- **Seen in the pane:** the Library with the first slice's book; the +, Book, the sheet; "Field guide" made from
  two notes tapped in order and opened on its two rows. Tests: the sheet (a name required; pages in the order
  tapped, found by name, moved, left out; the index made from exactly them), the dashboard (books newest first,
  the archive out, Recent without them), the index's picker adding two at once; 280 green around the change.

## 73. "Hey Ghost", memo mode gone, and Claude's connections counted (2026-09-22)

Three answers from a multiple-choice round Matt asked for ("ask me outstanding questions with multiple choice
answers I can click on"), built together.

- **"Hey Ghost".** The rename made the spoken word "Ghost" (§63), and "ghost" is a common word: a note that begins
  "Ghost stories…" was a command with no command in it. Matt chose "require hey Ghost for the new word": the
  recogniser (capture/command.ts) takes the new word only after "hey", "hi", "OK" or "so", and "Glyph" with or
  without them, as it always did. The copy that says the word says "Hey Ghost".
- **Memo mode is gone.** The memos screen went on the 20th; Matt chose "remove it" for the capture side. Out: the
  memo flow that asked which note first and answered trigger words, the `memo` preference and its synced entry and
  its row, continuation of the last spoken note, the scratch page and the memo-sorting screen, the waiting-memo card
  and palette entry, the flow's tips, the suite's eleven memo scripts. A recording is a new note, or the note whose
  Speak was pressed. Kept on purpose, being a different feature under the same noun: voice memos, the "voice memo …
  end memo" cue that keeps a clip of the tape inline. The draft, the live page, the better words and the suite kept
  writing with one `appendBody`, which now has a file of its own.
- **Claude's connections.** Several Claude accounts, or Claude on several computers, can be signed in to one Ghost.md
  account, each its own session with its own copy of the key, and nothing said so or could cut one off short of a
  restart. Matt chose "add both": `account_status` says `connections`, and `sign_out_everywhere` ends every session
  for the handle, this one included. The local server is one connection and hands in neither. They reach the box
  with the api.ghost.md move (blocked at the registry as of tonight: the domain is not delegated), or a --mcp
  deploy of their own.
- **A chapter made twice, prevented.** App.tsx `openTitle` made a note by a title from the list in hand, which can
  be a moment old; it asks the store again first.

## 74. Books: a mark on their pages, pages dragged into order, and a book read straight through (2026-09-22)

Three of the four Book slices Matt picked from the multiple-choice round (the fourth, making one by voice, is next).

- **A page says which book** (home/HomeScreen.tsx cards, notes/NoteTree.tsx rows): a title-to-book map built once
  per notes change (book/book.ts `bookIndex`, keyed the way `[[links]]` match), and a note that is a page wears the
  book's mark and name under its title. A book itself, or a note in none, wears nothing; a page in two books is
  marked with the first, as the chapter bar says.
- **Drag to reorder** (book/rowDrag.ts): each row has a grip; a finger holds 220ms before the row lifts, so a finger
  that meant to scroll still scrolls, a mouse lifts at once; the pointer is captured, the lifted row follows, the
  others make room, and on release the page lands where it was let go - in the index a chapter moved to a place,
  taking that row's depth (`withChapterAt`); in the New book sheet the pages reordered before the book is made. The
  shape the canvas and the tab row already drag with. The arrow buttons stay for the keyboard.
- **Read straight through** (book/BookView.tsx): the chapters one after another, each under its numbered title in
  the note's own editor, read-only, in the peek mode NotePeek draws with - the same formatter the note opens with -
  with the front matter and the chapter's own heading taken off (`bodyWithoutTitle`; `withoutFrontMatter` puts the
  front matter's title where the fences were, so that line goes too). A canvas chapter says so and opens on a tap; a
  chapter not written says so. A rail at the top scrolls to each; Index goes back.
- Tests: the map (first book wins; a book and a loose note answer nothing), the move-to-place (depth taken from the
  landing row; the ends), the drag (a mouse at once; a finger after the hold; a move before the hold is a scroll;
  a row let go where it was says nothing), the read-through (order, the canvas and the unwritten said, the rail,
  the way back), the body without its title.

## 75. Sharing a note or a book by a read-only link (2026-09-22)

Matt: "I'd like to be able to share books and notes with people online and allow them to read only the notes and
give them areas to fork the note into their own Ghost.md app." His answers: anyone with the link, encrypted; the
share follows his edits; a small reader page made only of the app's own parts; and keeping a copy either as a
Markdown download or as a copy saved into the reader's app. docs/SHARING.md has the whole of it.

- **The key stays in the link.** A share is sealed on the owner's device with a key of its own, and the key rides
  after the `#`, which browsers never send. The server holds ciphertext by an id, the same promise sync makes.
- **Edits follow.** Three seconds after a save, any share whose note (or, for a book, any chapter) changed is
  sealed and sent again under the same link. Stopping a share deletes it.
- **The reader page** is read.html, a second Vite entry: the editor read-only in its formatted view, the canvas
  read-only, a book's index and its chapter bar. It adds nothing the app doesn't already draw, so the formatted
  view's kept marks (a to-do's box, a wiki link's brackets) show here as they do there.
- **Keeping a copy.** Download gives the `.md`, or a `.zip` of a book's pages. Saving goes through the web app's
  `#fork=` or, in the phone and Mac apps, the + sheet's new "From a shared link". A copy is the reader's own: it
  doesn't follow, clashing titles take "(shared)", and a book's index is rewritten to name the copies.
- **The book bar on a phone.** A side of the bar was sized to its title and ran into the count at 375px wide; it
  now shrinks with an ellipsis, in the app as well as on the reader page.
- **Server:** a `shares` table and four routes beside sync (server/src/shares.rs), limits on size, count per
  account and public reads per IP. It needs a glyph-api deploy before any of this works outside a local run.
- **Seen in the pane, against a local server:** a book with a to-do list, a table and a canvas chapter, shared from
  the cog; read on the reader page at desktop and phone widths; downloaded as a zip; saved back twice, once by the
  web link and once by the + sheet ("(shared)", then "(shared 2)"); an edit read through the same link after the
  three seconds; the link reading nothing after "Stop sharing". Tests: sealing and links, what a note and a book
  share, the fork's renames, the downloads, the zip's CRC; the server's owner rules and limits.

## 76. A right-hand aside (2026-09-22)

Matt: "Add a right side aside menu that can pop out book indexes and list other notes from the workspace when not
in book view, add a sidebar toggle on the right with the icon reversed."

- **The toggle** (notes/NoteTabs.tsx): the sidebar's own icon, mirrored, at the tab row's far end; `aria-expanded`
  says which way it is, and the choice is kept to the device (`glyph-aside-shown`), hidden until opened once.
- **The shell** (App.tsx, app.css): on the split layout a third column, `clamp(240px, 22vw, 320px)`, beside the
  note - the sidebar's mechanism mirrored, `data-aside` on `.app-split` as `data-sidebar` is; on a phone a panel
  over the note from the right under a scrim, closed by the scrim, its X or the back gesture. Opening a note from
  the phone's panel closes it; the column stays.
- **What it holds** (aside/aside.ts, pure): with a book on screen - a page of one, or the book itself - the book's
  index, the open chapter ringed the way the sidebar rings the open note, a tap opening another, the book's title
  opening the book; anywhere else the workspace's other notes in the list's order, the open one and the archive
  left out, named after the workspace or "All notes".
- Tests: the two faces from the notes and the open note; the component's taps and its close.

## 77. A book stays in one tab (2026-09-22)

Matt, seeing the first cut: "the book should open in one tab instead of each page opening in a new tab." Every note
shown became a tab (notes/openTabs.ts `addOpen`), so reading a book left a tab per page behind.

- **The rule** (`swapOpen`): a page opened from inside a book - the index, the chapter bar, the right-hand aside, the
  read-through - takes the current tab's place. A page that already has a tab is used and the book's closes, so the
  row never gains a tab for a page. A `[[link]]` in the words still opens a tab, as any link does.
- **The mechanism** (App.tsx): the tab to give up is noted in a ref by `openTitleWithin` / `openNoteWithin`, and the
  effect that turns a shown note into a tab reads it once; `openNote` and `openTitle` clear it first, so a note opened
  any other way after a book's is not swapped by mistake. The note screen hands `onOpenWithin` to the index, the bar
  and the read-through; the aside opens "within" when it shows a book.
- Tests: the rule's four cases (in place; the page's own tab used and the book's closed; added where the row has no
  tab to take; the same note twice changes nothing).
