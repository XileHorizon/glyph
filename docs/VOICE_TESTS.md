# Voice tests

## The suite: one recording per feature

`voice-tests/suite.json` is the whole list: every spoken cue, command and recording behaviour, one short recording
each, with the notes it must leave. `npm run voice:text` writes it out as a script to record from
(`~/Desktop/Glyph voice tests.txt`), and `python3 scripts/voice-tests/make_audio.py --voice <id>` makes the recordings
with ElevenLabs into `~/Desktop/glyph-voice-tests/` (`--say <voice>` uses macOS's own voice instead, to try it
without a key).

Two runs check it:

- **From the scripts**, always, in `npm test` (`src/app/capture/voiceSuite.test.ts`): each line is one phrase with
  its silence, replayed through the recorder's own logic (`capture/take.ts`, which CaptureScreen drives), against the
  standard notes. This is the rules.
- **From the audio**, `npm run voice:suite`: Whisper on this Mac hears each recording through the phone's streaming
  path (`src-tauri/src/whisper/suite.rs`, into `.heard/` beside the files), and the same checks run on what it heard.
  This is the rules against real speech. `GLYPH_VOICE_ONLY=051 npm run voice:hear` hears one.

A test with `"prefs": {"memo": true}` runs as a memo (capture/memoFlow.ts): the take opens by asking which note, so
its first line names one ("Use note work.") and the rest are trigger words and talk. The "Memo flow" group covers it.

The older six-take walkthrough below is for playing into the phone by hand.

## By hand: six recordings, one note

Six scripts to record as audio (ElevenLabs), played into the phone's microphone while Glyph listens, to
check that every spoken cue writes the mark it promises and that plain speech stays plain. Together the
first five build one note, **Cabin weekend**, that holds one of everything the capture rules can write; the
sixth is prose that must not format, ending in silence. Each script lists what to say, what the note should
read afterwards, and what to look at on the screen.

The rules under test are `src/app/capture/markdown.ts` (cues), `command.ts` and `route.ts` (commands
while recording), `table.ts` (tables said a piece at a time), `quiet.ts` (stopping on silence) and
`wakeWord.ts`. The guide's marks page and `guide/phrases.ts` promise the same things; a script here that
fails is either a rule to fix or a promise to correct.

## Recording the audio

- One voice, a plain narrator at ordinary speed. No music, no effects.
- Say the punctuation. A colon after a cue word ("Heading: the plan") makes the voice pause there, and
  Whisper writes that pause back as a colon or a full stop, which is what the cue rules read. Keep the
  colons and full stops exactly as written.
- The pause tags are ElevenLabs break tags: `<break time="1.2s" />`. A pause under two seconds is a
  breath; the note stays in one paragraph. A pause of 2.5 seconds is a paragraph break
  (`PARAGRAPH_GAP_MS`), and so is saying "New paragraph".
- Between two cued sentences leave at least 0.8 s, so the engine commits them as separate phrases.
- Play the file from a laptop about 30 cm from the phone, at the loudness of someone talking across a
  table. Start Glyph listening (hold the side key, or tap Speak) a beat before the audio starts.
- Numbers may come back as digits ("4417") or words; both are fine unless a script says otherwise.

## Before you start

Two notes must exist for script 5's commands. Record this line first, as its own note:

> Title: groceries. `<break time="1.2s" />` We need eggs, milk, bread and coffee.

Expected note:

```markdown
# Groceries

We need:
- eggs
- milk
- bread
- coffee
```

And a note whose title starts "AttackFM bug bash" should exist (any body). If it doesn't, record
"Title: AttackFM bug bash. `<break time="1.2s" />` Things we found." as a second note.

## The target note

After scripts 1 to 5, **Cabin weekend** should read like this (the exact wording of a table cell or a
number can differ; the marks cannot):

```markdown
# Cabin weekend

We leave on Friday after work and come back Sunday night.

## The plan

Drive up Friday, hike Saturday, lazy Sunday.

The forecast says rain on Saturday afternoon.

Bring the board games in case.

## Packing

- The tent
- The stove
- Two sleeping bags

For the drive we need:
- snacks
- water
- a charger
- the good playlist

## On arrival

1. Unlock the shed
2. Turn the water on
3. Light the stove

## The order of things Saturday

1. Breakfast by eight
2. The ridge walk
3. Back before the rain

## Before we go

- [ ] Book the cabin
- [ ] Call Sam about the keys
- [ ] Fill the car up
- [ ] Pack the first aid kit

> The deposit comes back in full if the place is clean.

**Important:** They need the balance by Wednesday.

---

- Firewood from the farm shop

## The house rules

The deadline for the balance is **Wednesday at noon**, not Friday. The owner said the hot tub is _strictly off limits_ after ten. The gate code is ||four four one seven||, don't say it out loud. ==The wifi password is on the fridge==. %%I still think we should have booked the other place%%. The stove is ??gas??, it might be electric. Sam's number ends in @@zero seven seven one@@. ^^No shoes on the rug^^. Sunday breakfast is ++pancakes++.

- [ ] Buy ice

| What | Where | Packed |
| --- | --- | --- |
| Tent | Garage | Yes |
| Stove | Loft | No |
```

---

## Script 1: the skeleton

**Tests:** the title cue, the heading cue, "new paragraph", the two-second pause, and a comma sentence that
must stay a sentence.

**Say** (start a new note):

> Title: cabin weekend. `<break time="1.2s" />` We leave on Friday after work and come back Sunday night. `<break time="1.0s" />` New section: the plan. `<break time="1.2s" />` Drive up Friday, hike Saturday, lazy Sunday. `<break time="2.5s" />` The forecast says rain on Saturday afternoon. `<break time="1.0s" />` New paragraph. `<break time="1.0s" />` Bring the board games in case.

**Expected:**

```markdown
# Cabin weekend

We leave on Friday after work and come back Sunday night.

## The plan

Drive up Friday, hike Saturday, lazy Sunday.

The forecast says rain on Saturday afternoon.

Bring the board games in case.
```

**Watch for:** the title set large as the first line; "The plan" as a level-two heading with its `##`
dimmed; the Friday, Saturday, Sunday sentence staying one line (no intro word, so no list); the 2.5 s
pause and "New paragraph" each opening a paragraph; the live page's words arriving from smoke.

## Script 2: lists

**Tests:** bullet cues, a list said in one breath, an ordinal run (first, second, finally), and numbers
said out loud.

**Say** (continue the same note, or open it and tap Speak):

> Heading: packing. `<break time="1.2s" />` Bullet point: the tent. `<break time="0.9s" />` Next point: the stove. `<break time="0.9s" />` Bullet point: two sleeping bags. `<break time="1.5s" />` For the drive we need snacks, water, a charger and the good playlist. `<break time="2.5s" />` Heading: on arrival. `<break time="1.2s" />` First, unlock the shed. `<break time="0.9s" />` Second, turn the water on. `<break time="0.9s" />` Finally, light the stove. `<break time="2.5s" />` Heading: the order of things Saturday. `<break time="1.2s" />` Number one: breakfast by eight. `<break time="0.9s" />` Number two: the ridge walk. `<break time="0.9s" />` Number three: back before the rain.

**Expected:**

```markdown
## Packing

- The tent
- The stove
- Two sleeping bags

For the drive we need:
- snacks
- water
- a charger
- the good playlist

## On arrival

1. Unlock the shed
2. Turn the water on
3. Light the stove

## The order of things Saturday

1. Breakfast by eight
2. The ridge walk
3. Back before the rain
```

**Watch for:** the one-breath list keeping its intro line and lower-case items; the ordinal run counting
up rather than repeating "1."; "Number one" needing the pause after it (the colon) to count as a cue.

## Script 3: to-dos, a quote, a callout, a divider

**Tests:** the four to-do phrasings, the checkbox cue, the quote cue, the "Important" callout, the divider,
and a cue said on its own then applied to the next sentence.

**Say:**

> Heading: before we go. `<break time="1.2s" />` Remember to book the cabin. `<break time="0.9s" />` I need to call Sam about the keys. `<break time="0.9s" />` Check box: fill the car up. `<break time="0.9s" />` Don't forget to pack the first aid kit. `<break time="2.5s" />` Quote: the deposit comes back in full if the place is clean. `<break time="2.5s" />` Important: they need the balance by Wednesday. `<break time="2.5s" />` Divider. `<break time="2.5s" />` Bullet point. `<break time="1.2s" />` Firewood from the farm shop.

**Expected:**

```markdown
## Before we go

- [ ] Book the cabin
- [ ] Call Sam about the keys
- [ ] Fill the car up
- [ ] Pack the first aid kit

> The deposit comes back in full if the place is clean.

**Important:** They need the balance by Wednesday.

---

- Firewood from the farm shop
```

**Watch for:** the four to-dos drawn with boxes; the `>` quote set apart; the callout bold with its
colon; the rule on its own line; the lone "Bullet point." held and then applied to "Firewood".

## Script 4: marks inside a sentence

**Tests:** bold and italic said mid-sentence, and the seven marks of Glyph's own said the same way:
spoiler, highlight, aside, unsure, redact, shout, added. Each cue word opens, "end" plus the word closes.

**Say:**

> Heading: the house rules. `<break time="1.2s" />` The deadline for the balance is bold Wednesday at noon end bold, not Friday. `<break time="1.2s" />` The owner said the hot tub is italic strictly off limits end italic after ten. `<break time="1.2s" />` The gate code is spoiler four four one seven end spoiler, don't say it out loud. `<break time="1.2s" />` Highlight the wifi password is on the fridge end highlight. `<break time="1.2s" />` Aside I still think we should have booked the other place end aside. `<break time="1.2s" />` The stove is unsure gas end unsure, it might be electric. `<break time="1.2s" />` Sam's number ends in redact zero seven seven one end redact. `<break time="1.2s" />` Shout no shoes on the rug end shout. `<break time="1.2s" />` Sunday breakfast is added pancakes end added.

**Expected:**

```markdown
## The house rules

The deadline for the balance is **Wednesday at noon**, not Friday. The owner said the hot tub is _strictly off limits_ after ten. The gate code is ||four four one seven||, don't say it out loud. ==The wifi password is on the fridge==. %%I still think we should have booked the other place%%. The stove is ??gas??, it might be electric. Sam's number ends in @@zero seven seven one@@. ^^No shoes on the rug^^. Sunday breakfast is ++pancakes++.
```

**Watch for:** every pair of marks visible and dimmed around its words; the gate code in smoke until the
caret is put in it; the wash behind the wifi line; the aside smaller and leaning; the dotted line under
"gas"; a solid bar over the number that lifts when tapped; the small caps; the underline. Whisper may
write "end bold" as "and bold": the rule accepts that only when it heard a pause after the opening word,
so keep the 1.2 s breaks. Digits for the code and the number are fine.

## Script 5: commands while recording

**Tests:** the "Glyph" keyword, adding to another note's list, adding a task to this note, leaving a line
on a third note, a table said a piece at a time, and the yes that each command waits for. Needs the
Groceries and AttackFM bug bash notes from "Before you start".

**Say** (recording into Cabin weekend):

> Glyph, add oat milk to the groceries note. `<break time="2.5s" />` Yes. `<break time="2.5s" />` Glyph, add a task to cabin weekend: buy ice. `<break time="2.5s" />` Yes. `<break time="2.5s" />` Glyph, leave a note on AttackFM bug bash that says the login is still broken on Android. `<break time="2.5s" />` Yes. `<break time="2.5s" />` Glyph, add a table to this note with the columns what, where and packed. `<break time="2.5s" />` Tent, garage, yes. `<break time="1.5s" />` Stove, loft, no. `<break time="1.5s" />` Done. `<break time="2.5s" />` Yes.

**Expected:**

- Nothing after a "Glyph" lands in Cabin weekend as words: the commands never appear in the note.
- Groceries gains `- oat milk` at the end of its list.
- Cabin weekend gains `- [ ] Buy ice` at the end of its last list.
- AttackFM bug bash gains a line "The login is still broken on Android." (as an item if the note ends in
  a list, else as a paragraph).
- Cabin weekend ends with the table:

```markdown
| What | Where | Packed |
| --- | --- | --- |
| Tent | Garage | Yes |
| Stove | Loft | No |
```

**Watch for:** the recorder saying what it is about to do before each "yes", and doing nothing until it
hears it; the table conversation asking for rows after the columns and drawing the table (not pipes)
before the last yes; the drawn table in the note, which opens to its pipes when tapped. The 2.5 s pauses
before each "Yes" give the prompt time to appear.

## Script 6: prose that must stay prose, then silence

**Tests:** cue words used as ordinary words, which must not format; "then" outside an ordinal run;
"quote" mid-sentence; a comma sentence with no intro word; and the recording stopping on its own after
the voice stops.

**Say** (a new note):

> Title: a few notes. `<break time="1.2s" />` It was a bold move to book a cabin with no signal. `<break time="1.0s" />` Number one priority is sleep. `<break time="1.0s" />` The new item for the trip is a proper coffee grinder. `<break time="1.0s" />` We had a quote from the plumber last year and it was fine. `<break time="1.0s" />` Then we drove home, tired, happy. `<break time="2.5s" />` That's all for now. `<break time="3.0s" />` `<break time="3.0s" />` `<break time="3.0s" />`

**Expected:**

```markdown
# A few notes

It was a bold move to book a cabin with no signal. Number one priority is sleep. The new item for the trip is a proper coffee grinder. We had a quote from the plumber last year and it was fine. Then we drove home, tired, happy.

That's all for now.
```

**Watch for:** no bold, no numbered item, no to-do, no quote, no list; "Then" staying a word because no
"First" opened a run; the recorder ending the recording by itself during the nine seconds of silence at
the end, and the note saved with everything said.

## A seventh, if the app is open but not recording

The wake word. With Glyph open on the notes list and no recording running, play:

> Glyph, add a note to cabin weekend saying the neighbours have a dog.

**Expected:** the command prompt appears without a side key press, and after a "Yes" Cabin weekend gains
the line "The neighbours have a dog." Needs the voice model already on the phone.

## Keeping score

For each script note what came out against what was expected, in three columns: the cue, what the note
shows, and whether the fault is the rule (fix `markdown.ts` and add the phrase to its test) or the
transcription (a word Whisper mishears: change the cue or its vocabulary). A miss in the guide's own
examples is already covered by `guide.test.ts`, which renders every promise through the real rules.
