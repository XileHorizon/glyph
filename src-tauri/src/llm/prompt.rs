//! A request, framed in the model's chat template - with no model loaded.
//!
//! The engine needs the prompt in two pieces: the PREFIX (the template's
//! opening, the system prompt, any context and the template's user header),
//! which is the same from one note to the next and is snapshotted, and the
//! REST (the note and the template's closing), which is not. llama.cpp can
//! only render a whole conversation, so the conversation is rendered once with
//! a sentinel where the note goes, and cut at the sentinel.

/// Stands where the note will go. Private-use code points, which no template
/// writes and no tokenizer merges with a neighbour.
pub const SENTINEL: &str = "\u{E000}glyph-note\u{E001}";

/// Appended after the assistant header for a model whose template knows about
/// thinking: an empty thought, which is how Qwen's own templates switch
/// reasoning off. A model that reasons first spends hundreds of tokens before
/// the first word of the note, and a person watching the note take shape sees
/// nothing happen for a minute.
pub const EMPTY_THOUGHT: &str = "<think>\n\n</think>\n\n";

/// Closes a thought that has run past its budget, so the answer comes. Qwen's
/// own advice for budget forcing is to end the thinking in the model's voice
/// and close the tag: the model then answers from what it has thought so far.
pub const THOUGHT_CUTOFF: &str = "\n\nI have thought about this enough; time to give the answer from what I have so far.\n</think>\n\n";

/// The system message: the page's system prompt, then any context.
///
/// Context goes in the system message rather than beside the note so that it
/// is part of the snapshotted prefix: a project's context pack, when that
/// feature lands, is the longest thing in a prompt and the same for every note
/// on the project.
pub fn system_text(system: &str, context: Option<&str>) -> String {
    match context.map(str::trim).filter(|c| !c.is_empty()) {
        Some(context) => format!("{}\n\n{context}", system.trim_end()),
        None => system.trim_end().to_string(),
    }
}

/// The rendered conversation, cut at the sentinel.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Framed {
    pub prefix: String,
    pub suffix: String,
}

/// Cuts `rendered` - a conversation whose user message was [`SENTINEL`] - into
/// the part before the note and the part after it, adding [`EMPTY_THOUGHT`]
/// when the template `thinks`.
///
/// Refuses a rendering with no sentinel or more than one, which would mean the
/// template rewrote the message (trimmed it, escaped it) and the cut would put
/// the note somewhere the model was not told it would be.
pub fn frame(rendered: &str, thinks: bool) -> Result<Framed, String> {
    let mut parts = rendered.split(SENTINEL);
    let (Some(prefix), Some(suffix), None) = (parts.next(), parts.next(), parts.next()) else {
        return Err("the model's chat template did not keep the note in one place".to_string());
    };
    let mut suffix = suffix.to_string();
    if thinks && !suffix.contains("<think>") {
        suffix.push_str(EMPTY_THOUGHT);
    }
    Ok(Framed {
        prefix: prefix.to_string(),
        suffix,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const CHATML: &str = "<|im_start|>system\nYou format notes.<|im_end|>\n<|im_start|>user\n\u{E000}glyph-note\u{E001}<|im_end|>\n<|im_start|>assistant\n";

    #[test]
    fn the_prefix_is_everything_before_the_note() {
        let framed = frame(CHATML, false).unwrap();
        assert_eq!(framed.prefix, "<|im_start|>system\nYou format notes.<|im_end|>\n<|im_start|>user\n");
        assert_eq!(framed.suffix, "<|im_end|>\n<|im_start|>assistant\n");
    }

    #[test]
    fn the_snapshotted_prefix_excludes_every_user_utterance() {
        let framed = frame(CHATML, false).unwrap();
        let old = format!("{}{}{}", framed.prefix, "make Brofries", framed.suffix);
        let current = format!("{}{}{}", framed.prefix, "add eggs to groceries", framed.suffix);
        assert_eq!(&old[..framed.prefix.len()], framed.prefix);
        assert_eq!(&current[..framed.prefix.len()], framed.prefix);
        assert!(!framed.prefix.contains("Brofries"));
        assert!(!framed.prefix.contains("groceries"));
        assert_ne!(old, current, "only the uncached user remainder changes");
    }

    #[test]
    fn a_thinking_template_gets_an_empty_thought_once() {
        assert_eq!(frame(CHATML, true).unwrap().suffix, "<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n");
        let already = CHATML.replace("assistant\n", "assistant\n<think>\n\n</think>\n\n");
        assert_eq!(frame(&already, true).unwrap().suffix.matches("<think>").count(), 1);
    }

    #[test]
    fn a_template_that_lost_or_repeated_the_note_is_refused() {
        assert!(frame("<|im_start|>user\n<|im_end|>", false).is_err());
        assert!(frame(&format!("{SENTINEL}{SENTINEL}"), false).is_err());
    }

    #[test]
    fn context_joins_the_system_prompt_and_blank_context_does_not() {
        assert_eq!(system_text("Format.\n", Some("# Glyph\nA notes app.")), "Format.\n\n# Glyph\nA notes app.");
        assert_eq!(system_text("Format.", Some("  \n")), "Format.");
        assert_eq!(system_text("Format.", None), "Format.");
    }
}
