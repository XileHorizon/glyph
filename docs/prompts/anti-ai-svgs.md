# Prompts for the heads-up page's SVGs

Matt: "I want the graphics to be monochromatic and I don't want you to generate the assets themselves, I want you to give me prompts to make the SVGs for each." Then: "the SVG can change ONE color like red or the water going from blue to red, I just want most of it to be black and white with no shading, using white space and padding."

These prompts are for the three drawings on the guide's first page (guide/AntiAiStage.tsx). Each one:
- starts with the shared style block below;
- names its parts, so the animations can move them;
- gives the pivot points the animations turn them about.

(The brain gag was dropped at Matt's request.) Save the results as `src/app/guide/art/no.svg`, `seal.svg` and `datacenter.svg`. The stage then loads them in place of the placeholder drawings.

---

## Shared style (paste at the top of every prompt)

```
Create a single hand-authored SVG file, clean and minimal, for a mobile app's onboarding animation.

Canvas and format
- Root: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180">. No width/height attributes.
- Transparent background. No <rect> filling the canvas.
- No <text> unless asked, no embedded images, no <style> blocks, no inline style attributes, no filters, no masks, no clip paths. The only classes allowed are "paper" and "accent".
- Round every coordinate to at most 1 decimal place. Keep the whole file under 12 KB.

Colour: black and white, plus ONE accent
- Line work and solid shapes are black: use fill="currentColor" and stroke="currentColor" (the app sets this to the page's ink).
- White areas are the paper: give them class="paper" and fill="#fff" (the app sets this to the page's background, so it works on light and dark themes).
- Exactly ONE accent colour in the whole file, only on the parts named in the prompt: give those shapes class="accent" and the fill or stroke colour stated. The app may animate that colour.
- NO shading of any kind: no gradients, no opacity, no tints, no halftone, no hatching, no drop shadows. Every shape is solid black, solid white, or the one accent.

Look
- Flat, bold, graphic cartoon like a black-and-white editorial spot illustration: thick confident outlines (stroke-width 4 for main shapes, 2.5 for details), stroke-linecap="round", stroke-linejoin="round".
- Simple geometric construction, few nodes. Let white space do the work: keep at least 16 units of empty padding from every canvas edge (except parts the prompt says enter from an edge), leave clear gaps between separate objects, and keep the composition uncluttered and centred.
- Readable at 320×180 on a phone: no detail thinner than 2 units.

Structure for animation (important)
- Put every named part in its own <g id="…"> exactly as listed, in the listed order (first listed = drawn first, at the back).
- Do NOT put transform attributes on the named groups; draw each part in its final resting position in canvas coordinates.
- Parts that turn or scale must be drawn around the pivot point given, so they can be rotated about that exact coordinate.
- Output only the SVG code.
```

---

## 1. The no symbol (`no.svg`)

```
[shared style]

Accent: red, #E5322D, on the sign only.

Draw a big, bold "prohibited" sign: a circle with a diagonal slash from top-left to bottom-right, centred at (160, 90), with plenty of white space around it.

Parts, in order:
- <g id="sign">: the prohibition sign. A ring with outer radius 62 and inner radius 46, drawn as a single path with fill-rule="evenodd", class="accent" fill="#E5322D", plus the slash as a rounded bar 16 units thick from the ring's inner edge at top-left to its inner edge at bottom-right, also class="accent" fill="#E5322D". Pivot for scaling: (160, 90).

Make it feel stamped and punchy: perfectly symmetric, no outline, nothing else on the canvas.
```

---

## 2. The seal and the club (`seal.svg`)

```
[shared style]

Accent: red, #E5322D, on the BONK burst's letters and the lump only.

A cute cartoon baby harp seal lying on an ice floe floating in the sea. It is about to get bonked on the head by a wooden club held by an arm coming in from the top-right edge of the canvas. Tone: silly slapstick cartoon, never gory, no blood.

Parts, in order:
- <g id="sea">: the sea as two or three simple wavy black lines along the bottom, from x 16 to 304 around y 146–160. No filled water.
- <g id="waves">: one separate, longer wavy black line from x -40 to x 360 at y ≈ 156, stroke only, so it can slide sideways in a loop. (The only part allowed to run past the edges.)
- <g id="floe">: a flat, slightly irregular ice floe the seal lies on, top edge around y 124, spanning x 60–268; black outline, class="paper" fill.
- <g id="seal-body">: the seal's plump body lying along the floe, facing LEFT, centred around (164, 108), about 104 wide and 38 tall, with a small back flipper at the right (≈ x 222) and a front flipper under the chest. Black outline, class="paper" fill, one short belly line.
- <g id="seal-head">: the round head at the left end of the body, centre (116, 96), radius about 24, with a muzzle, a small solid black nose at about (96, 101) and three short whiskers each side. Pivot for the bonk squash: the bottom of the head at (116, 120).
- <g id="eyes-open">: two big round solid black eyes at about (108, 90) and (124, 89), radius 5.5, each with a small class="paper" highlight dot.
- <g id="eyes-x">: two X-shaped eyes at the same positions, same size, black strokes only (for after the bonk).
- <g id="lump">: a small round cartoon bump sticking up from the top of the head at about (120, 72), radius 8, class="accent" fill="#E5322D" with a black outline. Pivot for growing: (120, 80).
- <g id="stars">: three small five-pointed cartoon stars above the head at about (92, 60), (144, 58) and (118, 48), radii 6, 5 and 4, black outline with class="paper" fill. They will orbit around (116, 56).
- <g id="arm">: a sleeve coming down from above the top edge of the canvas at x ≈ 226–254 (allowed to enter from the top edge), ending in a round fist at (240, 22). Black outline, class="paper" fill.
- <g id="club">: a caveman-style wooden club, thin at the handle and thick at the far end, lying horizontally and pointing LEFT from the fist: the handle starts at (240, 22) and the fat end reaches x ≈ 104, about 8 units thick at the handle and 20 at the end. Black outline, class="paper" fill, two short black grain strokes. Draw it horizontal: it will be rotated about the fist at (240, 22) to swing down onto the seal's head.
- <g id="bonk">: a comic impact burst (10-pointed jagged star, radius ≈ 36) centred at (80, 58), black outline with class="paper" fill, and the word BONK inside it in heavy condensed letters, class="accent" fill="#E5322D", rotated -12°. This is the only <text> allowed; alternatively convert the letters to paths. Pivot for popping: (80, 58).
```

---

## 3. The datacenter and the lake (`datacenter.svg`)

```
[shared style]

Accent: the lake water only, class="accent" fill="#2F7DF6" (blue). The app turns it from this blue to a sick toxic colour while the scene plays, so draw the water as ONE flat shape with no detail inside it.

A small cartoon datacenter building on the left pumping water out of a lake on the right. As the scene plays the lake turns toxic: sludge blobs, a belly-up fish, stink lines and a skull appear (those are black and white; only the water changes colour). Tone: satirical, grim-funny, simple.

Parts, in order:
- <g id="ground">: one clean black ground line across from x 16 to 304 at y 138, broken by a bowl-shaped dip for the lake between x 160 and 296. No filled ground.
- <g id="steam">: three simple round steam puffs above the building roof at about (50, 34), (78, 28) and (104, 36), radii 8, 10 and 7, black outline with class="paper" fill, each its own group: "steam-1", "steam-2", "steam-3".
- <g id="building">: a boxy datacenter from (24, 48) to (124, 138) with rounded corners and a roof trim, black outline with class="paper" walls, and three tall server racks side by side at x 36, 64 and 92, each 20 wide and 56 tall starting at y 70, solid black.
- <g id="leds">: fifteen tiny status lights, 5 per rack in a column, radius 2.2, class="paper" fill so they show on the black racks, each with its own id "led-1" … "led-15".
- <g id="pipe">: a thick rounded pipe as a black outline with class="paper" fill (about 10 wide) from the building's right wall at (124, 104) across to (152, 104), curving down into the lake at (170, 132).
- <g id="drips">: two small drops falling from the pipe mouth at (170, 138), radii 3.4 and 2.8, black outline with class="paper" fill.
- <g id="water">: the lake water filling the dip, a shallow bowl from x 166 to 290, surface at y 138, bottom at y 166, ONE flat shape, class="accent" fill="#2F7DF6", with a black outline.
- <g id="sludge">: three or four gloopy sludge blobs bulging up from the water's surface, solid black, drawn so they read on top of any water colour.
- <g id="bubbles">: three round bubbles on the water at about (204, 156), (230, 162) and (256, 152), radii 4, 3 and 5, black outline with class="paper" fill.
- <g id="fish">: a small simple fish in the water at about (232, 152), 24 wide, facing left, class="paper" body with black outline, tail at the right. Pivot for flipping belly-up: (234, 152).
  - Inside it, <g id="fish-eye">: a solid black dot eye at (223, 150), radius 1.8.
  - Inside it, <g id="fish-eye-x">: a tiny black X eye at the same spot, stroke only.
- <g id="stink">: three wavy vertical black stink lines rising from the lake at x 204, 230 and 256, from y 124 up to y 92, stroke only, stroke-width 3, with ids "stink-1" to "stink-3".
- <g id="skull">: a small cartoon skull-and-crossbones, about 20 tall, floating above the lake's right side at (282, 106), black outline with class="paper" fill and solid black eye sockets. Pivot for popping: (282, 106).
```

---

## Checking what comes back

- Open each file large in a browser.
  - Everything should be black or white, apart from the one accent.
  - There should be no grey, no gradient, and a transparent background.
- Search the file for `id="` to check every id is there, in order, and for `class="accent"` to check the accent is only on the parts named.
- If a tool bakes a `transform` onto a named group, ask it to redraw that part in place without transforms, or flatten the transforms before sending the file back.
