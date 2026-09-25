# Instruction-aware voice commands

## Safety boundary

Whisper phrase commits are listen-only: they update the visible accumulated transcript and nothing else. They do not derive a title, create or update a note, route a command, or invoke a model. Only an explicit Done/stop obtains the complete final transcript and classifies it once. A wake word still works, but is not required. The complete transcript is scanned for a request anywhere in it (`commandScan.ts`): a note-changing verb (`add`, `put`, `make`, `create`, `start`, `throw`, `jot down`…), optionally after the words people put before one (`can you`, `let's`, `go ahead and`, `I want you to`), or `I need a list of…`. A verb alone is dictation ("I need to make dinner"), so each needs evidence within the next words: a list/note word, `called/named/labeled`, or one of the person's note titles. Reported or quoted requests ("I told Sam to add…") are skipped. A request at the very start is *anchored* and behaves as before; one found later is *conversational*: if it cannot be carried out, the model calls it ordinary talk, or the person cancels its card, the recording is saved as a note rather than discarded. The deterministic parser runs against that complete transcript first; `ai_infer_command` receives the complete transcript and the person's note titles (titles only, never bodies or ids) once, only on a parser miss, and may answer `create` with content for requests like "make a list called X and add A and B". The native pre-check refuses only a destructive verb aimed at a note, list or everything within a few words; several steps are no longer refused as compound.

A leading wake word or filler (`Hey Ghost,`, `Okay, um,`, `can you`) is stripped before the gate, so it no longer turns a command into a note of its own words; a command reported mid-sentence still stays ordinary.

Natural append forms include `add to the note labeled Go …`, `add to my note called "Go" …`, `add to the note named Go …`, `add to Go …`, and `add to the to-do list …`. When the words after the title announce a list (`a list with …`, `a to-do list of …`, `the following items: …`), they become separate items (`spokenList.ts`): US `City State` pairs are told apart by the state even with no commas, so `parkersburg west virginia marietta ohio` is two bullets, `Parkersburg, West Virginia` and `Marietta, Ohio`. A finished recording may also create a list: `make a new list called Comic books` offers an empty titled list, and `… called Comic books and add to the list Spider-Man, Batman and Superman` (or `… with …`, `…, add … to it`, `… Add these: …`) offers the title with those items; confirming creates the note through `apply_command_mutation` and moves the recording to it. A title that only contains `with` (`Books with pictures`) stays whole unless several items follow. When the rules hear a note name they cannot match, the on-device model reads the transcript once before the command is rejected; a list it returns is split by the app, not the model, and each item is escaped as literal text. The title is matched against actual titles case- and punctuation-insensitively, and only the words after the matched title are payload. Missing and non-unique targets reject rather than choosing a note. New-note, destructive, compound, and other unsupported final instruction shapes reject without saving their command prose. If inference is unavailable or invalid, the complete transcript visibly falls back to an ordinary note; it never executes an action.

The native model can produce only this allowlisted intent set:

- `append { target, content, placement }`
- `create { target, content? }`
- `none { reason }`

`target` is a spoken title, never a database id. The model never receives note bodies and cannot return ids, offsets, or Markdown decisions. Model content is serialized as escaped literal Markdown text, so headings, links, images, emphasis, code fences, tables, HTML, and list syntax cannot become model-owned structure. llama.cpp generation uses the native `llm::command::GRAMMAR`; there is no IPC field for a grammar. Rust parses the entire output with unknown fields denied and validates action-specific fields, lengths, control characters, and truncation. TypeScript validates the IPC value again.

The selected formatting model is used only when it is installed. Otherwise the already-installed Qwen3.5 2B model is the fallback. Glyph never downloads a model for a command and never calls remote AI. If another llama.cpp run is active, inference returns unavailable rather than queueing behind or disturbing it. iOS returns unavailable for inference while deterministic commands remain functional.

## Reading a recording with the model: sort, then plan

When the rules (`command.ts`) do not know the phrasing, and the recording has any request word or names a note, the model reads the whole recording in two small steps through `ai_voice_step` (`voicePlan.ts`; prompts and grammars in `llm/command.rs`):

1. **sort** answers one word: `note`, `add`, `new` or `mixed`. `note` ends it: dictation.
2. **plan** answers `{"actions":[…],"note":…}`. Each action is `append` (a title from the person's notes, `items` as a JSON array or `text`, `as` list/tasks/text) or `create` (a title and `items`); `note` is the rest of what was said worth keeping. At most three actions.

The app checks everything: shape, that an append's note is one of the person's notes, and that every item, title and note is made of words that were said (`grounded`; numbers must be said too, "two" and "2" alike). What fails is dropped and written to the log. Model text is escaped so it cannot become Markdown structure. One card shows all the changes; confirming runs them in order as guarded writes, keeps the rest as its own note, and gives the recording to that note (or the first note changed).

Settings › Recording › **Voice log** keeps the last 40 recordings on the phone: the transcript, each step (rules, the model's raw sort and plan, what the checks dropped) and what the person chose, with Copy and Clear.

## Mutation boundary

TypeScript resolves inferred title strings to `resolved`, `ambiguous`, or `not-found`, and creates final Markdown with deterministic placement rules. A confirmation card shows the exact action before any write.

### Stopped audio and lifecycle

On Done, native capture first writes audio under the fresh capture id while classification and confirmation are pending. On a confirmed append it atomically moves (or appends) that WAV to the confirmed note before recording metadata is updated; cancellation and rejection discard only the temporary audio. Unavailable inference finalizes an ordinary note under that original capture id, so both its transcript and audio remain available. This prevents an incomplete phrase from assigning a recording to the wrong note. The confirmation remains on the capture screen, so a normal background/foreground cycle retains both the in-memory final transcript and its temporary WAV; process termination before a decision can leave an unreachable temporary WAV, which is safe but currently not garbage-collected. The transcript is never intentionally dropped for inference failure: that path finalizes a normal note immediately.

List semantics are application policy, not an inference privilege. `Groceries`,
`Grocery`, `Shopping`, and `List` default to ordinary bullets; `To Do`, `Todo`,
`Task`, and `Tasks` default to unchecked task items. A list that already has
items retains its own bullet/task/number style. These defaults apply when the
model returns `placement: null` and to deterministic add commands alike.

Confirmed append/create writes call `apply_command_mutation`. Ghost.md 1.6.0’s Markdown-file Library compares both the previewed note revision and body while holding its writer lock, writes the new body, and records a durable guarded undo in the Library index. For an append targeting the note currently being captured, Glyph pauses autosaves, flushes the current transcript through the serialized draft queue, previews against the returned revision, then hands the post-command base back to later autosaves. This prevents a stale draft from overwriting the command or duplicating the transcript. Undo succeeds only while that exact command result is current. Its log survives restart; on launch Glyph re-offers a recent interrupted Undo once, while a later edit makes Undo return a conflict rather than overwrite newer work.

The active Library index carries a monotonic `revision` for each Markdown file and increments it on body saves, command writes, external file changes, and command undo. The legacy SQLite migration store also gains the same column so old libraries can be imported safely.

Ordinary note persistence also separates birth from edit. `create_note` may
insert only a new id; `update_note` updates only the exact existing revision.
Editor, capture drafts, plugins, refinement, and table writes have no upsert
path. Therefore a queued write holding a deleted id receives a conflict and
cannot recreate the row. Deleting the current memo continuation forgets it
immediately, and every main-Speak launch awaits deferred deletion before the
capture mounts or reads candidates.

## Inference session isolation

Each `CaptureScreen` is a fresh keyed mount whose transcript, pending command,
and inference refs start empty; unmount and Finish cancel any active inference.
Each native generation calls `clear_kv_cache()` before prefill. The only reused
state is a snapshot captured after the immutable system/template prefix and
before the per-job user remainder. `llm/prompt.rs` tests that user utterances
are outside that prefix. Previous Speak text is therefore neither a frontend
prompt input nor part of the restored llama KV state.

## Evaluation

`src/app/capture/instructionCorpus.json` is the repeatable language corpus. Its test executes deterministic cases and production-contract fixture inference, asserting action, target, content, placement, rejection, and no-mutation failure paths. It covers clean and messy AttackFM append requests, create with and without content, ambiguous and missing targets, destructive and compound requests, quoted/numeric payloads, and ordinary memo prose. `standaloneSpeak.test.ts` executes Kevin's four separate Speak sessions through the same parser, Markdown placement, and CAS store contracts.

The Whisper prompt supports a fixed vocabulary but not per-session dynamic note titles. It now biases command terms and `Groceries`/`Grocery list`. An unsafe ASR title such as `Brofries` is never silently rewritten: confirmation shows that heard title, and a later `grocery` request does not match or mutate it.

Run contract and deterministic evaluation with:

```sh
npm test -- --run src/app/capture/instructionIntent.test.ts src/app/capture/instructionCorpus.test.ts src/app/capture/instructionMutation.test.ts src/app/capture/route.test.ts src/app/capture/listAppend.test.ts src/app/core/store.test.ts
cd tools/host-tests && cargo test
```

`cargo test --lib` in `src-tauri/` also runs `llm::command::tests` and
`store::tests`, but it builds the whole crate first: tauri pulls the desktop
windowing stack (`tao` -> `dbus` -> `libdbus-sys`, which needs `dbus-1.pc` and
the dbus headers) and the crate builds llama.cpp and whisper.cpp, several
minutes of C++ for tests that never load a model. On a Linux host without
`libdbus-1-dev` it fails before any test runs.

`tools/host-tests` is a small cargo workspace that compiles the active `library/mod.rs`, legacy migration `store.rs`, `llm/command.rs`, and `llm/prompt.rs` from the real source tree with `#[path]`—no copies—against only their direct dependencies. These modules contain no `tauri::` type; the harness stops compiling if that boundary changes.

A physical Android run with an installed Qwen3.5 2B or larger catalogue model is still required to measure inference accuracy, latency, cancellation, and concurrent Whisper responsiveness. No model fixture is downloaded by tests.
