# Lovart

Matt, 2026-10-26: "I'd like to build a Lovart.ai plugin into the app. They have a API for OpenClaw and I think we can
build a wrapper around that in order to create images automatically based on notes and with some custom inline syntax.
For example during design meetings the Lovart.ai plugin can generate inspo images and such. Please create the basics of
the plugin and do research on OpenClaw for Lovart."

The plugin is `lib/plugins/lovart/`. It is a built-in plugin, off until added in Settings › Plugins (category AI),
because it sends words to Lovart and spends the person's Lovart credits.

## OpenClaw, and how Lovart plugs into it

**OpenClaw** (github.com/openclaw/openclaw, MIT) is an open-source personal agent that runs on your own machine and is
extended by *skills*: a folder with a `SKILL.md` that tells the agent when and how to use it, and scripts it runs.
Skills are shared on **ClawHub** and installed with the `skills` CLI.

**Lovart** (lovart.ai) is a "design agent": you describe an image, a set of images, a video or a brand kit, and its
agent picks models and makes them on a canvas in a Lovart project. Lovart has no public, documented REST API. What it
publishes for agents is the **Lovart skill**:

- source: github.com/lovartai/lovart-skill (`skills/lovart-skill/SKILL.md`, `scripts/agent_skill.py`);
- install: `npx skills add lovartai/lovart-skill`, or from ClawHub as `@lovart-admin/lovart-skill`;
- it is a zero-dependency Python client over what the skill calls **"Lovart Agent OpenAPI"**, authenticated with an
  access key / secret key pair (AK/SK) the user makes in Lovart: your profile › **Lovart Agent** › **OpenClaw** (Matt, 2026-10-28; the skill's README says avatar menu › AK/SK Management).

So "the API for OpenClaw" is that HTTP API. This plugin does not run OpenClaw or the Python skill: it calls the same
API directly from the app (`client.dart`), ported line for line from `agent_skill.py` **as read on 2026-10-26**. The
API is undocumented and can change without notice; when it does, that file is the reference to re-read.

## The API

Base `https://lgw.lovart.ai`; every path begins `/v1/openapi`.

| Call | Body / query | Answers (`data`) |
| --- | --- | --- |
| `POST /mode/query` | `{}` | the account's mode and models; changes nothing, so the plugin uses it to **check keys** |
| `POST /project/save` | `{"project_id":"","canvas":"","project_cover_list":[],"pic_count":0,"project_type":3}` | `project_id` of a new project |
| `GET /project/validate` | `?project_id=` | `valid`, `project_name` |
| `POST /chat` | `{"prompt","project_id","thread_id"?,"mode"?,"attachments"?}` (the plugin sends `"mode":"fast"`; `attachments`, image URLs, for Figma frames) | `thread_id` |
| `GET /chat/status` | `?thread_id=` | `status`: `running`, `done` or `abort` |
| `GET /chat/result` | `?thread_id=` | `items[]`, `failures[]`, maybe `pending_confirmation` |
| `POST /chat/confirm` | `{"thread_id"}` | approves a costly step. **The plugin never calls it.** |

Other calls the skill has and the plugin does not use yet: `/mode/set` (fast vs unlimited queue), file upload (`POST /file/upload`, multipart `file`, answers `data.url`),
model preferences (`tool_config.include_tools` / `prefer_tool_categories`; SKILL.md lists the tool names, e.g.
`generate_image_midjourney`, `generate_image_nano_banana_pro`), brand kits and subjects, project rename.

**Signing.** Each request carries `X-Access-Key`, `X-Timestamp` (unix seconds), `X-Signature` =
`hex(HMAC-SHA256(secretKey, "METHOD\npath\nseconds"))` with the path *without* its query, `X-Signed-Method`,
`X-Signed-Path`, `Content-Type: application/json`, and a browser-like `User-Agent`
(`Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) LovartAgentSkill/1.0`): Cloudflare in front of Lovart refuses
library defaults. A POST also sends `Idempotency-Key` (a uuid hex), the same on every retry. Each retry is signed again.
HMAC is `package:crypto`, already a dependency (pubspec.yaml); no new package.

**Envelope.** `{"code":0,"message":…,"data":{…}}`; `code` not 0 is an error whose `message` is a sentence for the
person. HTTP errors carry JSON `message` (and `details`). Known: **401** keys wrong; **402 / code 2012** credits, plan,
free tier, risk control, phone verification and the like (Lovart's message is shown as-is); **409 / code 2011** a task
already running on the thread; **429** rate limited (the plugin waits `Retry-After`, at most a minute, then tries once
more). GETs are retried on 404/502/503 and dropped connections, as the skill does.

**Polling.** Status every 3 s. On `done`, wait 5 s and look again (the agent's sub-tasks can start late), then fetch
the result. From the seventh poll, every third poll also reads the result for `pending_confirmation`, which never
finishes by itself. The plugin gives up after 5 minutes.

**Results.** Images are `items[type == "generator"].artifacts[type == "image"].content`, URLs on
`assets-persist.lovart.ai`, fetched with `Referer: https://www.lovart.ai/`. `done` with no artifact means the agent
declined (moderation) or answered in words: the plugin says the assistant's text (`LovartRefused`).
`pending_confirmation` (a premium model, a video) is said with its `estimated_cost` (`LovartNeedsConfirmation`) and the
cue stays; the person approves it in Lovart if they want it.

**No size, shape or count parameters.** Those go in the prompt's words ("Make one image.", "four separate images").

**Limits.** Reported as chat 60 a minute and 600 an hour, queries 300 a minute; those figures are not in the skill's
source as read here, which says only that a 429 (code 1429) means "retry in ~60s". Treat them as unconfirmed.

**Hosts.** The manifest lists `lovart.ai`, which covers `lgw.lovart.ai` and `assets-persist.lovart.ai`; the host
refuses anything else, and an artifact URL elsewhere is skipped.

## Keys, credits and terms

- Each person brings **their own** AK/SK. There is no shared Ghost.md key, and none should be added: the keys bill the
  person's Lovart credits, and Lovart's terms are written for a user's own use of their account.
- The keys are kept in the device's secure store (`glyph-lovart-access-key`, `glyph-lovart-secret-key`) and follow the
  account **sealed** with the other connections (lib/sync/connections.dart), with the plugin's switch. The project id
  and the meetings switch stay on each device.
- Every image costs Lovart credits. Which Lovart plans include AK/SK access is not documented; ask Lovart before relying
  on it for a team.
- **The setup** (lib/plugins/lovart/lovart_setup.dart, on the plugins' setup flow in lib/plugins/onboarding/; Matt,
  2026-10-28: "For each of the plugins add a small onboarding flow start with the lovart and Claude plugins"): what it
  is and about 6 credits an image; an account, Open lovart.ai (`https://www.lovart.ai/`: Lovart has no sign-up address
  of its own, its home page's Get started is the way in); the keys, avatar menu › AK/SK Management, as the skill's
  README says, with Open Lovart (`https://www.lovart.ai/home`, signed in, where that menu is: the AK/SK page has no
  address anyone has published, so the link is to the menu's page, and the menu path is the skill's word, not seen
  here signed in); the pair pasted and kept where the page keeps them; the check, `POST /mode/query`, said in the
  client's own words (401 refused and the keys let go of, 402 Lovart's sentence with the keys kept, no connection
  `lovartUnreachable`); and Try it, a cue to copy and the Header images switch. Nothing is made, nothing spent.
  Offered as Lovart is added in the Market without keys, and from Set up at the head of its page. Words in
  lib/plugins/onboarding/setup_voice.dart; test/plugins/lovart/setup_test.dart.

## What the plugin adds

**Inline syntax: `{image: a prompt}`.** Anywhere in a line; `{image:prompt}` and any case of `image` work. It is a cue
once the closing `}` is there and the prompt has words. Not after `{`, `$` or `\`, not closed by `}}`, not in code. It
never collides with the blanks, which begin `{?` (lib/core/blanks_syntax.dart). While the plugin is on, the editor washes
the cue faintly and draws Lovart's mark just after it (lib/editor/ai/lovart_cues.dart); a tap makes that cue, and the
mark turns while it is made. With the plugin off it is plain text.

A cue alone on its line becomes `![prompt](image/lovart-<uuid>.png)`; a cue among words is taken out of the words and
the picture goes on its own line after (after any pictures an earlier cue on that line put there).

**Make images** (note's cog, shown when the note has cues): every cue in order, saying progress. A refusal leaves that
cue and goes on; bad keys, credits or a step awaiting confirmation stop the rest.

**Inspiration images** (note's cog): a moodboard of four from the note's title and its summary (or its first 1500
characters), one image per artifact, appended under `## Inspiration` (or added to the one there is).

**Inspiration for design meetings** (switch on the plugin's page, off by default): when a meeting is written up
(lib/root/root_voice.dart `meetingSummarized`, after the sorter and Slack), a meeting whose title has a design word, or
whose summary has two different ones (design, mockup, wireframe, UI, UX, brand, logo, moodboard, visual, palette,
typography, layout, prototype, illustration, Figma, style guide, icon…), gets the same section in the closed note.
Once per meeting, remembered before Lovart is asked.

**Header images** (switch on the plugin's page, **on** by default; Matt, 2026-10-26: "add a setting to automatically
generate header images for notes (turn it on by default when lovart is enabled)"): a banner across the top of a note,
made when the note is **left** (lib/root/root_parts.dart `onScreenChanged` → lib/plugins/lovart/banners.dart
`LovartBanners.noteLeft`), and on the note's cog as **Header image** (makes one again where there is one). The prompt is
the house style, the ghost's stipple dotwork word for word from tauri/docs/GHOSTS.md (`bannerStyle`), with the note's
title and its first 900 characters as the subject; 4:1, the ghost small on the right two-thirds, the left third white.
The banner is front matter `banner: "![](image/lovart-….png)"` (lib/core/banner.dart): a picture's own Markdown, so
sync, team sync, export and the trash's sweep follow it with no change. The note page draws it under the header
(lib/note/note_banner.dart) in the page's inks, white as paper and black as ink, so it turns over in dark mode as the
ghost scenes do. Made by itself only for a note of 25 words or more that is not a ticket, a meeting (Ghost's, or a
recording with a summary), a mail (`from:`), a notebook, a canvas or a template, has no banner, and was never given
one: remembered by id before Lovart is asked, so a banner taken off is not made again.

**Header images for many notes, in the background** (lib/plugins/lovart/banner_run.dart; Matt, 2026-10-26: "Make the
header generation async and a background task that runs while the app is generating the images"). Two ways in:
**Make them** on the plugin's page (the 100 most recent notes waiting for one, with two choices for the run: *Include
notes whose header was taken off*, and *Redo black-and-white and square headers*), and **Header images for every
page** on a notebook's More sheet ("Also add a feature to add header images to all pages in a book"), which asks
first how many pages and about how many credits, with *Redo existing too* and *Not now*. Either is one job of the
app's own (`BannerJob`, made by the root): three at a time, its queue kept in the plugin's storage as it goes so a run
the app was closed under goes on at the next launch, written into an open note through its editor (the root's
`_changeNote`, as Claude's edits are). A line on home and in the sidebar says "Making header images · 12 of 100" with
Stop; a toast says how it ended. On Android a foreground service holds the app up while it runs, with its own
notification and Stop (android/…/ghost_md/BackgroundJobs.kt, `ghost_md/jobs`); on the Mac the app is kept out of App
Nap. A run is claimed in the synced settings (`lovartBannerRun`) before it starts, so two of the account's devices
never make the same notes' pictures. Credits are said as an estimate, about 6 an image (`lovartCreditsPerImage`,
client.dart), since the API gives no cost for an ordinary image.

**At the limit of jobs at once** (Matt, 2026-10-27: "It keeps stopping from hitting the concurrent job limit"): a
refusal that is Lovart having no room (`LovartFailure.busy`: 409, 429, code 2011, or words like "concurrent job
limit") never stops a run. The note goes back in line, the run asks one fewer at a time (down to one), and the worker
waits 20 s times how many refusals running (at most 80 s) before asking again. Only twelve refusals running at one at
a time stop it, saying so; the rest wait for Make them. A header made as a note is left that meets it is not marked
given, so leaving the note again asks again.

**In the background, all of it** (Matt, 2026-10-27: "The lovart generation stops when the app is not in focus please
background the task"): the header run held the device, but a header made as a note is left, Header image, `{image: …}`
and a moodboard did not, and the Fold froze the app twelve seconds after it went behind another, Lovart and the sync
"couldn't be reached". lib/plugins/lovart/lovart_hold.dart holds the device (Android's foreground service, the Mac
out of App Nap) as job `lovart-work` while any picture is being made outside the run, and lets it go quietly after the
last. The device's half now keeps each job apart: one ending lets the hold go only where it was that job's (Android) or
the last held (the Mac, a set of ids). A lost connection (`LovartFailure.lost`: unreachable, no answer, a 5xx) is
waited out by the run as a busy Lovart is (`passing`), and a header as a note is left that meets it is asked again.

**The queue** (Settings › Lovart › Queue; Matt, 2026-10-27: "Please show the lovart image queue in the lovart
settings"): every picture being made on this device and the ones waiting, by note title, "Making" or its place in
line, with what is left to make in credits (lib/plugins/lovart/lovart_queue.dart). It reads the run's kept queue
(`keptBannerQueue`), the header being made as a note is left (`lovartBannerMaking`), `{image: …}` cues
(`lovartMaking`) and moodboards (`lovartInspiring`, lib/plugins/lovart/making.dart); a run on another device is one
line, its notes being that device's to list. Twenty waiting are listed, the rest counted.

**Figma frames as references** (switch "Use linked Figma frames" on the plugin's page, **off** by default; Matt,
2026-11-02: "when we have figma plugin connected would it be possible to feed figma designs into the lovart inspo
generator or header generator?", then "build it and deploy the update"; lib/plugins/lovart/figma_refs.dart). With it on
and the Figma plugin connected with its token, a note's **Header image** (made as the note is left, from the cog, or in a
run), its **Inspiration images** and a design meeting's inspiration send the Figma frames the note links to as the
chat's `attachments`: every figma.com address in the note that names a file, each once, in order, at most three; a
frame's own render where the link has a `node-id`, the file's thumbnail where it has none, asked fresh of Figma's API
with the person's token (lib/plugins/figma/client.dart `FigmaClient.frame`). They go as Figma's picture addresses,
which Lovart fetches and reviews itself (the skill's SKILL.md: "`--attachments` takes any image URL"), so no picture
passes through the device; a frame Figma will not say is left out and the image is made from the words as before. The
prompt gains a line saying what they are: for a banner, the palette, shapes and subject to draw in the house's style,
not a copy; for a moodboard, four directions that build on the design. Lovart may drop a reference that fails its
review and still finish: the result's `failures` (`LovartClient.failuresOf`, kept as `dropped`) are said on the note
("Lovart left out a Figma frame: …") for the cog's actions, and logged for the jobs nobody asked for. Off by default
because it sends the person's designs, which may be a client's, where until now only words went.

**Field sketches** (switch "Field sketches" on the plugin's page, **off** by default; Kevin, 2026-11-04: "an optional
toggle for image enrichment where when it is adding images it parses the text to find natural spots to add in generated
images that relate to the text section in pretty spots so it looks alive and sorta magical";
lib/plugins/lovart/sketches.dart, sketch_make.dart). Small drawings of one object each, in the manner of a 19th-century
naturalist's field journal (sepia ink, watercolour, a transparent ground, 4:5: Kevin's prompt, `sketchStyleDefault`,
editable as **Sketch prompt**, with `{subject}` or `[SUBJECT]` where the thing drawn is named), beside the paragraphs
they belong to. **Where:** `sketchSpots` reads the note's blocks, leaving out front matter, code, tables, maths, HTML,
tasks, `{image: …}` lines and the Inspiration, Transcript, Links, References and Sources sections; a paragraph of 35
words or more is a place for one, the longest in each section first, 140 words or more from any picture and not just
before one, one for every 220 words of the note and at most four, sketches already there counting. **What:** the
paragraph's words go to Lovart with the prompt and how to choose the subject (the one concrete thing it names or most
evokes, looked up where it is a real one), so Lovart's agent picks it and no other model is asked. **Made:** one at a
time, in order, each written in as it lands, as `![Field sketch for <section>](image/lovart-sketch-….png)` on its own
line after the paragraph; a stand-in waits under every paragraph waiting for one (lib/editor/ai/lovart_cues.dart,
`lovartSketching`). As a note is left, for a note a banner could be made for of 120 words or more, not a notebook's
cover, once per note (`sketchesDoneKey`; a note with no place yet is not marked, so one that grows is looked at again);
and on the note's cog as **Add field sketches**, which adds wherever there is room. **Drawn:** a picture named
`lovart-sketch-` is drawn small and unframed, two fifths of the column and at most 300 px wide, no taller than a third
of the screen, taking turns at the end and the start of the line (lib/editor/media/images.dart `ImageWidget`).
**Paper:** not every model Lovart picks can give a true alpha channel; a sketch that comes back with opaque pale,
colourless ground at its edges (white paper, a painted grey checkerboard) has that ground, reached from the edges,
made clear and its fringe faded (sketch_clear.dart, `dart:ui` only), so the drawing sits on the page in light and dark.

**The badge.** A picture whose name begins `lovart-` carries Lovart's mark at its bottom right (20 px on a dark rounded
ground, inset 8 px, "Made with Lovart" to a screen reader) wherever it is drawn: the editor's figures, an embedded
note, a canvas picture card, on every device, plugin on or not (lib/editor/media/lovart_badge.dart).

## The mark

`assets/plugins/lovart/lovart-mark.svg` is the round "Lo" mark from the header of **https://www.lovart.ai/** (the
inline `<svg>` beside the wordmark, read 2026-10-26; the page's `<link rel=icon>` is `/favicon.ico`, and the logo its
JSON-LD names, `https://assets-persist.lovart.ai/web/logo/lovart-logo.svg`, answered 404). Its fill is set to black
and recoloured where it is drawn (`flutter_svg`, already a dependency; lib/plugins/lovart/lovart_mark.dart). It is a
third party's mark: it is drawn only in the plugin's own places (its page, its actions, the cue's mark, the badge), and
never in the store listing or its screenshots. The catalogue card uses the Lucide `palette` icon.

## Left for later

- Fast vs unlimited mode (`/mode/set`). (The model picker is built: Image model on the plugin's page, 2026-11-04,
  sent as `tool_config.prefer_tool_categories` `{"IMAGE": [tool]}`; lib/plugins/lovart/models.dart.)
- Approving a pending costly step from the app (a confirm button that names the cost), and resuming a thread that timed
  out (`/chat/result` again later).
- Attachments: a note's own pictures as references (`/file/upload`, then the address it answers as an attachment).
  Figma frames go already, as addresses (above).
- A link to the Lovart canvas (`https://www.lovart.ai/canvas?projectId=…`) on each picture.
- A cue said aloud while recording ("Ghost, image of …").
