//! What whisper says, made fit to show a person - and the prompt that goes back
//! in: the cue vocabulary, then the tail of what has been committed.
//!
//! Whisper was trained on subtitles, and subtitles describe the soundtrack:
//! `[BLANK_AUDIO]`, `(music)`, `[Applause]`, `♪`. On a notes app every one of
//! those is noise in the transcript, and worse, a `[BLANK_AUDIO]` that reaches
//! the page as a partial is a flicker of text over a silent microphone. whisper.
//! cpp's `suppress_nst` stops most of them at the decoder; this is the net
//! under it, because "most" is measured in tokens and the tokens are not the
//! only way the model spells them.
//!
//! What this deliberately does NOT try to catch: the unbracketed
//! hallucinations - "Thank you.", "Thanks for watching!" - that whisper
//! produces on silence. There is no string test for those that does not also
//! delete a person actually saying thank you. They are kept away by never
//! sending near-silent audio to the model at all, which is `stream.rs`'s job.

/// Strips non-speech annotations and tidies the whitespace they leave behind.
///
/// Anything inside `[...]` or `(...)`, and the music notes, goes. Whisper does
/// not emit brackets for real speech in English - a person saying "in
/// parentheses" gets the words - so the rule costs nothing a dictation needs.
/// Nested or unclosed brackets swallow to the end of the text rather than
/// letting half an annotation through: an unclosed `(upbeat` is a truncated
/// annotation, never the start of a sentence.
///
/// Returns the empty string when nothing that could be a word survives. A
/// partial of `" - "` or `"..."` is the same flicker as `[BLANK_AUDIO]`.
pub fn clean(raw: &str) -> String {
    let mut kept = String::with_capacity(raw.len());
    let mut depth = 0usize;
    for c in raw.chars() {
        match c {
            '[' | '(' => depth += 1,
            ']' | ')' if depth > 0 => depth -= 1,
            // A stray closer with nothing open is a character, not markup -
            // but whisper never emits one, so it is simply dropped too.
            ']' | ')' => {}
            '♪' | '♫' => {}
            // Control characters (NUL above all) cannot cross into a C string
            // for the next prompt, and have no business in a note.
            c if c.is_control() => kept.push(' '),
            c if depth == 0 => kept.push(c),
            _ => {}
        }
    }

    let mut out = String::with_capacity(kept.len());
    for word in kept.split_whitespace() {
        // "Hello [BLANK_AUDIO] ." leaves a full stop standing on its own.
        // Punctuation that opens a word attaches to the word before it.
        let attaches = word.starts_with(['.', ',', '!', '?', ';', ':']);
        if !out.is_empty() && !attaches {
            out.push(' ');
        }
        out.push_str(word);
    }
    if out.chars().any(char::is_alphanumeric) {
        out
    } else {
        String::new()
    }
}

/// The spoken cues the capture formatter (`src/app/capture/markdown.ts`)
/// listens for, written the way it parses them, as the start of every prompt.
///
/// Whisper reads its prompt as the text that came before the audio and matches
/// that text's spelling and punctuation. Measured on base.en with three `say`
/// voices, cues with no prompt came back as "Number 1.", "2. Pack the
/// charger", "bold ... and bold", "at Point" and "Happy Budget!". The first
/// two miss the parser's `number one` and the rest are not cues at all. With
/// this line in front the same audio gave "Number one.", "end bold",
/// "Bullet point." and "Heading." for every voice. Plain dictation came back
/// the same, except that the fixture's streamed "Northwind" became "North
/// Wind" once. Streaming time on base.en did not change (7.9 s before, 7.7 s
/// after, for 13 s of audio). On noise, the filler whisper produces changes
/// from "you" to "The." (and once "Thanks for watching!"). It never recited
/// the vocabulary, and the streamer does not send noise to the model anyway.
/// `tests::cue_vocabulary` reruns the comparison.
///
/// Cue words only, with no sample content. A word in the prompt is a word
/// whisper is more willing to hear, and "milk" is not a word to make likely.
/// Twelve cues is about thirty tokens, well inside the 224 whisper.cpp keeps.
/// When it trims, it trims from the front, so this line goes before the
/// committed tail and is the part that gets dropped first.
///
/// "Glyph" closes it, the keyword every spoken command starts with. Without it
/// twelve synthesised voices wrote "Gliff", "Gliv", "Glit", "Life" and "Live"
/// for it; with it a few more came back as "Glyph" or a spelling
/// `capture/command.ts` knows, and plain dictation did not change. It leads
/// the line: at the end, just before the committed tail, it read as a
/// sentence of its own and a phrase carried across a cut started over in
/// capitals (`tests::a_prompt_tail_carries_a_sentence_across_the_cut`).
pub const CUE_VOCABULARY: &str = "Glyph. Title. Heading. Bullet point. Number one. Check box. To do. Quote. \
    Important. Bold, end bold. Italics, end italics. Divider. New paragraph. \
    Create list. Add to list. Called. Groceries. Grocery list.";

/// The cues added since, spoken far less often: in the prompt only where a sentence has just ended, since any word
/// past the short list above made base.en start a sentence cut in two with a capital (the prompt-tail test in
/// tests.rs), and a cue only ever starts a sentence anyway.
pub const MORE_CUES: &str = "Subheading. Option. Info box. Hidden line. Calculate. Hashtag. Counter. \
    Strike, end strike. Code, end code. Note link, end link. Voice memo, end memo. \
    Done task. Footnote. Code block. Superscript. Subscript. Maths. Emoji. Anchor. Item link. Bookmark this. New line. Define.";

/// The prompt for the next window: the cue vocabulary, then the committed tail.
pub fn prompt(committed: &str, tail_chars: usize) -> String {
    let tail = prompt_tail(committed, tail_chars);
    if tail.is_empty() {
        format!("{CUE_VOCABULARY} {MORE_CUES}")
    } else if tail.trim_end().ends_with(['.', '!', '?']) {
        format!("{CUE_VOCABULARY} {MORE_CUES} {tail}")
    } else {
        format!("{CUE_VOCABULARY} {tail}")
    }
}

/// Removes the cue vocabulary if whisper recites it back.
///
/// When whisper cannot make out the audio, it can repeat its prompt as the
/// transcript. No run of the measurement did, and the streamer does not send
/// silence to the model, but a note that fills with "Title. Heading. Bullet
/// point." would cost a person their trust in capture. So any run of THREE
/// or more consecutive sentences that are each a vocabulary cue is removed.
/// People say cues one at a time, before the words they introduce, so three
/// cues in a row with nothing between them is the prompt, not the speaker.
/// One or two in a row are kept, because "Bullet point." on its own is
/// exactly how a cue is said before a pause.
pub fn without_prompt_echo(text: &str) -> String {
    const RUN: usize = 3;
    let cues: Vec<String> = sentences(CUE_VOCABULARY).chain(sentences(MORE_CUES)).map(normalise).collect();
    let pieces: Vec<&str> = sentences(text).collect();
    let is_cue: Vec<bool> = pieces
        .iter()
        .map(|p| cues.contains(&normalise(p)))
        .collect();

    let mut keep = vec![true; pieces.len()];
    let mut start = 0;
    while start < pieces.len() {
        let end = (start..pieces.len())
            .find(|&i| !is_cue[i])
            .unwrap_or(pieces.len());
        if end - start >= RUN {
            keep[start..end].iter_mut().for_each(|k| *k = false);
        }
        start = end.max(start + 1);
    }
    if keep.iter().all(|k| *k) {
        return text.to_string();
    }
    pieces
        .iter()
        .zip(keep)
        .filter_map(|(piece, kept)| kept.then_some(*piece))
        .collect::<Vec<_>>()
        .join(" ")
}

/// Sentences, each with its closing mark, split where `.`, `!` or `?` meets
/// whitespace. Trimmed, never empty.
fn sentences(text: &str) -> impl Iterator<Item = &str> {
    let mut rest = text;
    std::iter::from_fn(move || {
        rest = rest.trim_start();
        if rest.is_empty() {
            return None;
        }
        let mut chars = rest.char_indices().peekable();
        while let Some((at, c)) = chars.next() {
            let ends = matches!(c, '.' | '!' | '?')
                && chars.peek().is_none_or(|(_, next)| next.is_whitespace());
            if ends {
                let (sentence, after) = rest.split_at(at + c.len_utf8());
                rest = after;
                return Some(sentence);
            }
        }
        let sentence = rest;
        rest = "";
        Some(sentence.trim_end())
    })
}

fn normalise(sentence: &str) -> String {
    sentence
        .trim_end_matches(['.', '!', '?', ',', ' '])
        .to_lowercase()
}

/// The last `max_chars` of `committed`, starting on a whole word.
///
/// This is what goes to whisper as the prompt for the next window, and it
/// exists for casing and punctuation: a window that starts mid-sentence
/// otherwise comes back capitalised and full-stopped as if it were the start of
/// a document. A few hundred characters is enough to carry "we are in the
/// middle of a sentence about X"; more costs decoder time on every single
/// inference and pulls the model towards repeating itself.
///
/// Cut at a word boundary because a prompt that begins "ing the kettle" is a
/// prompt that begins with a token the model has to explain.
pub fn prompt_tail(committed: &str, max_chars: usize) -> &str {
    let total = committed.chars().count();
    if total <= max_chars {
        return committed.trim_start();
    }
    let start = committed
        .char_indices()
        .nth(total - max_chars)
        .map(|(at, _)| at)
        .unwrap_or(0);
    let tail = &committed[start..];
    // Starting exactly on a word is only a word boundary if what came before
    // it was a space.
    let on_boundary = committed[..start].ends_with(char::is_whitespace);
    if on_boundary {
        return tail.trim_start();
    }
    match tail.find(char::is_whitespace) {
        Some(space) => tail[space..].trim_start(),
        // One word longer than the whole budget: better no prompt than half a
        // token.
        None => "",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn annotations_go_and_the_words_stay() {
        assert_eq!(clean(" [BLANK_AUDIO]"), "");
        assert_eq!(clean(" (music)"), "");
        assert_eq!(clean(" ♪ ♪"), "");
        assert_eq!(clean(" Buy milk. [BLANK_AUDIO]"), "Buy milk.");
        assert_eq!(
            clean(" (upbeat music) Ring the plumber."),
            "Ring the plumber."
        );
        // The full stop left standing when the annotation between it and its
        // word goes has to rejoin the word, or the note reads "Hello ."
        assert_eq!(clean(" Hello [BLANK_AUDIO] ."), "Hello.");
    }

    #[test]
    fn text_with_no_word_in_it_is_no_text() {
        assert_eq!(clean(" - "), "");
        assert_eq!(clean("..."), "");
        assert_eq!(clean(""), "");
    }

    #[test]
    fn an_unclosed_annotation_swallows_to_the_end_rather_than_leaking() {
        assert_eq!(clean(" Right. (upbeat"), "Right.");
    }

    #[test]
    fn the_prompt_is_the_vocabulary_then_the_committed_tail() {
        assert_eq!(prompt("", 200), format!("{CUE_VOCABULARY} {MORE_CUES}"));
        assert_eq!(prompt("   ", 200), format!("{CUE_VOCABULARY} {MORE_CUES}"));
        // After a finished sentence the rarer cues come too; mid-sentence only the short list, so the words carry on.
        assert_eq!(prompt("Call the plumber.", 200), format!("{CUE_VOCABULARY} {MORE_CUES} Call the plumber."));
        assert_eq!(
            prompt("Remember to descale the kettle before Thursday", 20),
            format!("{CUE_VOCABULARY} before Thursday")
        );
    }

    #[test]
    fn the_vocabulary_is_one_line_of_cue_sentences() {
        // The `\` continuation must not leave a run of spaces in the prompt.
        assert!(!CUE_VOCABULARY.contains("  "), "{CUE_VOCABULARY:?}");
        assert_eq!(sentences(CUE_VOCABULARY).count(), 18);
        assert!(!MORE_CUES.contains("  "), "{MORE_CUES:?}");
    }

    #[test]
    fn a_recited_vocabulary_is_removed() {
        assert_eq!(without_prompt_echo(CUE_VOCABULARY), "");
        assert_eq!(without_prompt_echo("Title. Heading. Bullet point."), "");
        assert_eq!(
            without_prompt_echo(
                "Buy milk. Title. Heading. Bullet point. Number one. Call the bank."
            ),
            "Buy milk. Call the bank."
        );
        // Whisper's casing and closing marks vary, so the match ignores both.
        assert_eq!(without_prompt_echo("title. HEADING! bullet point?"), "");
    }

    #[test]
    fn cues_said_one_or_two_at_a_time_are_speech() {
        for said in [
            "Bullet point.",
            "Bullet point. Oat milk.",
            "Title. Heading.",
            "Number one. Book the flights. Number two. Pack the charger.",
            "Bold, this really matters, end bold.",
            "Important. The deadline moved to Friday.",
        ] {
            assert_eq!(without_prompt_echo(said), said);
        }
    }

    #[test]
    fn sentences_split_only_where_a_mark_meets_a_space() {
        let got: Vec<&str> = sentences("It costs 3.50 today. Really? Yes!  And then").collect();
        assert_eq!(got, ["It costs 3.50 today.", "Really?", "Yes!", "And then"]);
    }

    #[test]
    fn the_prompt_tail_starts_on_a_whole_word() {
        let committed = "Remember to descale the kettle before Thursday";
        // 20 chars back lands inside "kettle"; the tail skips to the next word.
        assert_eq!(prompt_tail(committed, 20), "before Thursday");
        assert_eq!(prompt_tail(committed, 200), committed);
        // Exactly on a boundary keeps the word it lands on.
        assert_eq!(prompt_tail("one two three", 5), "three");
        assert_eq!(prompt_tail("supercalifragilistic", 5), "");
    }

    #[test]
    fn the_prompt_tail_counts_characters_not_bytes() {
        // A cut by bytes would land inside the multi-byte é and panic.
        let committed = "café au lait, s'il vous plaît";
        assert_eq!(prompt_tail(committed, 12), "vous plaît");
    }
}
