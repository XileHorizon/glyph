//! Fixed contract for voice-command inference.
//!
//! The model may translate one utterance into append/create/none strings. It
//! never sees note ids or bodies and can never return offsets or Markdown
//! structure decisions. Returned content is untrusted literal user text; the
//! application serializer escapes it before inserting Markdown.

use serde::{Deserialize, Serialize};

pub const MAX_TARGET_CHARS: usize = 120;
pub const MAX_CONTENT_CHARS: usize = 4_000;

/// Native-owned grammar. No caller can provide or modify it.
pub const GRAMMAR: &str = r#"
root ::= ws (append | create | none) ws
append ::= "{" ws "\"action\"" ws ":" ws "\"append\"" ws "," ws "\"target\"" ws ":" ws string ws "," ws "\"content\"" ws ":" ws string ws "," ws "\"placement\"" ws ":" ws placement ws "}"
create ::= "{" ws "\"action\"" ws ":" ws "\"create\"" ws "," ws "\"target\"" ws ":" ws string ws "," ws "\"content\"" ws ":" ws (string | "null") ws "}"
none ::= "{" ws "\"action\"" ws ":" ws "\"none\"" ws "," ws "\"reason\"" ws ":" ws reason ws "}"
placement ::= "\"bugs\"" | "\"tasks\"" | "\"list\"" | "\"notes\"" | "null"
reason ::= "\"unsupported\"" | "\"destructive\"" | "\"compound\"" | "\"unclear\""
string ::= "\"" chars "\""
chars ::= char*
char ::= [^"\\\x00-\x1F] | "\\" (["\\/bfnrt] | "u" [0-9a-fA-F] [0-9a-fA-F] [0-9a-fA-F] [0-9a-fA-F])
ws ::= [ \t\n\r]*
"#;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "action", rename_all = "lowercase")]
pub enum CommandIntent {
    Append {
        target: String,
        content: String,
        placement: Option<Placement>,
    },
    Create {
        target: String,
        content: Option<String>,
    },
    None {
        reason: NoneReason,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Placement {
    Bugs,
    Tasks,
    List,
    Notes,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum NoneReason {
    Unsupported,
    Destructive,
    Compound,
    Unclear,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawIntent {
    action: String,
    #[serde(default)]
    target: Option<String>,
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    placement: Option<Placement>,
    #[serde(default)]
    reason: Option<NoneReason>,
}

fn clean(value: String, max: usize, label: &str) -> Result<String, String> {
    let value = value.trim().to_string();
    let count = value.chars().count();
    if count == 0 || count > max || value.chars().any(char::is_control) {
        return Err(format!(
            "the inferred {label} is empty, too long, or contains control characters"
        ));
    }
    Ok(value)
}

/// Parses the entire model answer. Prose, fences, trailing JSON, unknown keys,
/// wrong field combinations, and truncated output all fail closed.
pub fn parse(text: &str, truncated: bool) -> Result<CommandIntent, String> {
    if truncated {
        return Err("the command inference was truncated".into());
    }
    let value: serde_json::Value = serde_json::from_str(text.trim())
        .map_err(|_| "the command inference was not exactly one valid object".to_string())?;
    let object = value
        .as_object()
        .ok_or_else(|| "the command inference was not an object".to_string())?;
    let action = object
        .get("action")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("");
    let expected: &[&str] = match action {
        "append" => &["action", "target", "content", "placement"],
        "create" => &["action", "target", "content"],
        "none" => &["action", "reason"],
        _ => return Err("the command inference used an unsupported action".into()),
    };
    if object.len() != expected.len() || expected.iter().any(|key| !object.contains_key(*key)) {
        return Err("the command inference used unsupported or missing fields".into());
    }
    let raw: RawIntent = serde_json::from_value(value)
        .map_err(|_| "the command inference fields had invalid types".to_string())?;
    match raw.action.as_str() {
        "append" if raw.reason.is_none() => Ok(CommandIntent::Append {
            target: clean(
                raw.target
                    .ok_or_else(|| "append has no target".to_string())?,
                MAX_TARGET_CHARS,
                "target",
            )?,
            content: clean(
                raw.content
                    .ok_or_else(|| "append has no content".to_string())?,
                MAX_CONTENT_CHARS,
                "content",
            )?,
            placement: raw.placement,
        }),
        "create" if raw.reason.is_none() && raw.placement.is_none() => Ok(CommandIntent::Create {
            target: clean(
                raw.target
                    .ok_or_else(|| "create has no title".to_string())?,
                MAX_TARGET_CHARS,
                "title",
            )?,
            content: raw
                .content
                .map(|content| clean(content, MAX_CONTENT_CHARS, "content"))
                .transpose()?,
        }),
        "none" if raw.target.is_none() && raw.content.is_none() && raw.placement.is_none() => {
            Ok(CommandIntent::None {
                reason: raw.reason.ok_or_else(|| "none has no reason".to_string())?,
            })
        }
        _ => Err("the command inference used an unsupported field combination".into()),
    }
}

/// A model is not asked to reinterpret requests outside the single safe set:
/// a destructive verb aimed at a note, a list or everything in one. The verb
/// alone is not enough - people say "remind me to send the invoice" and name
/// films like "Send Help" - so it needs its object within a few words.
/// Several steps ("make a list and add…") are one request now: the model
/// answers them as a create with content, or none.
pub fn refusal(utterance: &str) -> Option<NoneReason> {
    const DESTRUCTIVE: &[&str] = &[
        "delete", "remove", "erase", "destroy", "archive", "overwrite", "replace", "rename", "clear",
        "wipe", "empty", "share", "email", "send",
    ];
    const OBJECTS: &[&str] = &[
        "note", "notes", "list", "lists", "page", "everything", "all", "it", "them", "that", "this",
    ];
    const REACH: usize = 6;
    let lower = utterance.to_lowercase();
    let words: Vec<&str> = lower
        .split(|c: char| !c.is_alphanumeric() && c != '\'')
        .filter(|word| !word.is_empty())
        .collect();
    for (at, word) in words.iter().enumerate() {
        if DESTRUCTIVE.contains(word)
            && words[at + 1..].iter().take(REACH).any(|next| OBJECTS.contains(next))
        {
            return Some(NoneReason::Destructive);
        }
    }
    None
}

/// The model's question: the person's note titles, then what they said. Titles
/// are cleaned of control characters and cut short; bodies and ids never go in.
pub fn user_prompt(utterance: &str, titles: &[String]) -> String {
    let titles: Vec<String> = titles
        .iter()
        .map(|title| {
            title
                .chars()
                .map(|c| if c.is_control() { ' ' } else { c })
                .take(80)
                .collect::<String>()
                .trim()
                .to_string()
        })
        .filter(|title| !title.is_empty())
        .take(60)
        .collect();
    let notes = if titles.is_empty() { "(none)".to_string() } else { titles.join("; ") };
    format!("Notes: {notes}\nSaid: {utterance}")
}

// ---- conversational voice: sort, then plan -----------------------------------------------------

/// Step one of reading a recording: what kind of thing it is. One word, so a
/// small model answers it fast and reliably.
pub const SORT_GRAMMAR: &str = r#"
root ::= "{" ws "\"kind\"" ws ":" ws kind ws "}"
kind ::= "\"note\"" | "\"add\"" | "\"new\"" | "\"mixed\""
ws ::= " "?
"#;

pub const SORT_SYSTEM: &str = r#"You sort one recording made in a notes app. People talk naturally: they dictate, think out loud, and sometimes ask the app to change their notes, often after other talk. Their notes are listed first. Answer with JSON: {"kind": "..."}.
- "note": they are dictating or thinking out loud, or talking about something someone else will do or something for later. Nothing to change.
- "add": they ask for things to go into one or more of their existing notes.
- "new": they ask for a new list or note to be made.
- "mixed": they ask for a change and also say other things worth keeping as a note, or ask for a new list and an addition to an existing note.

Examples:
Notes: Movies; Groceries
Said: So I was at the store and it was packed. Anyway can you put oat milk and bread on the groceries list?
{"kind":"add"}
Notes: Movies
Said: I really need a list of comic books, like Spider-Man, Batman and the Fantastic Four.
{"kind":"new"}
Notes: Groceries
Said: Meeting went long today, Sam wants the report by Friday. Oh and add coffee to groceries.
{"kind":"mixed"}
Notes: Groceries
Said: I told Sam I would add the photos to the album later, and I need to make dinner.
{"kind":"note"}"#;

/// Step two: the plan. Items are a real JSON array, so the model - not a
/// comma rule - says where one item ends and the next begins.
pub const PLAN_GRAMMAR: &str = r#"
root ::= "{" ws "\"actions\"" ws ":" ws actions ws "," ws "\"note\"" ws ":" ws nstring ws "}"
actions ::= "[" ws "]" | "[" ws action ws ("," ws action ws)? ("," ws action ws)? "]"
action ::= append | create
append ::= "{" ws "\"do\"" ws ":" ws "\"append\"" ws "," ws "\"note\"" ws ":" ws string ws "," ws "\"items\"" ws ":" ws items ws "," ws "\"text\"" ws ":" ws nstring ws "," ws "\"as\"" ws ":" ws as ws "}"
create ::= "{" ws "\"do\"" ws ":" ws "\"create\"" ws "," ws "\"title\"" ws ":" ws string ws "," ws "\"items\"" ws ":" ws items ws "," ws "\"as\"" ws ":" ws as ws "}"
items ::= "[" ws "]" | "[" ws string ws ("," ws string ws)* "]"
as ::= "\"list\"" | "\"tasks\"" | "\"text\""
nstring ::= string | "null"
string ::= "\"" char* "\""
char ::= [^"\\\x00-\x1F] | "\\" (["\\/bfnrt] | "u" [0-9a-fA-F] [0-9a-fA-F] [0-9a-fA-F] [0-9a-fA-F])
ws ::= " "?
"#;

pub const PLAN_SYSTEM: &str = r#"Turn one recording made in a notes app into a plan, in JSON: {"actions": [...], "note": ...}. Their notes are listed first, then what kind of request it is, then what they said.
Actions:
- {"do":"append","note":"<one of their note titles>","items":["..."],"text":null,"as":"list"} puts items into an existing note. "as" is "tasks" for to-dos or tasks. For words that are not a list, "items":[], "text":"<the words>", "as":"text".
- {"do":"create","title":"<the new note's title>","items":["..."],"as":"list"} makes a new list; "items" may be [].
Rules:
- Each item is one whole thing, in their words: "Parkersburg, West Virginia", "The Fantastic Four", "Back to the Future". Never add a thing they did not say.
- Leave the request out of items and titles: no "can you", "add to", "make a list called", "like", "and".
- "note" is anything else they said worth keeping, without the request and without filler (um, so, anyway, okay), or null.
- At most three actions.

Examples:
Notes: Groceries; Movies
Kind: add
Said: So I was at the store and it was packed. Anyway can you put oat milk and bread on the groceries list?
{"actions":[{"do":"append","note":"Groceries","items":["oat milk","bread"],"text":null,"as":"list"}],"note":"I was at the store and it was packed."}
Notes: Go
Kind: add
Said: add to my note labeled go a list with parkersburg west virginia marietta ohio and detroit michigan
{"actions":[{"do":"append","note":"Go","items":["Parkersburg, West Virginia","Marietta, Ohio","Detroit, Michigan"],"text":null,"as":"list"}],"note":null}
Notes: Movies
Kind: new
Said: okay I really need a list of comic books like spider man batman superman the fantastic four and the green lantern
{"actions":[{"do":"create","title":"Comic Books","items":["Spider-Man","Batman","Superman","The Fantastic Four","The Green Lantern"],"as":"list"}],"note":null}
Notes: Work; Groceries
Kind: mixed
Said: Meeting went long today, Sam wants the report by Friday. Put call the printer guy on my work to-dos and add coffee to groceries.
{"actions":[{"do":"append","note":"Work","items":["call the printer guy"],"text":null,"as":"tasks"},{"do":"append","note":"Groceries","items":["coffee"],"text":null,"as":"list"}],"note":"Meeting went long today. Sam wants the report by Friday."}"#;

/// The question for a voice step: the person's note titles, the kind step one
/// found (for the plan), then the whole recording.
pub fn voice_prompt(transcript: &str, titles: &[String], kind: Option<&str>) -> String {
    let asked = user_prompt(transcript, titles);
    match kind {
        Some(kind) => asked.replacen("\nSaid: ", &format!("\nKind: {kind}\nSaid: "), 1),
        None => asked,
    }
}

/// A voice step's answer: exactly one JSON object, not cut short. Its shape is
/// checked field by field in TypeScript before anything is offered.
pub fn check_answer(text: &str, truncated: bool) -> Result<serde_json::Value, String> {
    if truncated {
        return Err("the model's answer was cut short".into());
    }
    let value: serde_json::Value = serde_json::from_str(text.trim())
        .map_err(|_| "the model's answer was not one valid JSON object".to_string())?;
    if !value.is_object() {
        return Err("the model's answer was not an object".into());
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_the_small_structured_set() {
        assert_eq!(
            parse(r#"{"action":"append","target":"Attack FM","content":"losing position at 42%","placement":"bugs"}"#, false).unwrap(),
            CommandIntent::Append { target: "Attack FM".into(), content: "losing position at 42%".into(), placement: Some(Placement::Bugs) }
        );
        assert_eq!(
            parse(
                r#"{"action":"create","target":"apartment stuff","content":null}"#,
                false
            )
            .unwrap(),
            CommandIntent::Create {
                target: "apartment stuff".into(),
                content: None
            }
        );
    }

    #[test]
    fn control_characters_fail_for_append_and_create_content() {
        for bad in [
            "{\"action\":\"append\",\"target\":\"AttackFM\",\"content\":\"bad\\nheading\",\"placement\":\"bugs\"}",
            "{\"action\":\"create\",\"target\":\"Safe\",\"content\":\"bad\\tcontent\"}",
            "{\"action\":\"append\",\"target\":\"AttackFM\",\"content\":\"bad\\u0000value\",\"placement\":\"bugs\"}",
        ] {
            assert!(parse(bad, false).is_err(), "{bad}");
        }
    }

    #[test]
    fn malformed_truncated_extra_and_wrong_shapes_fail_closed() {
        for bad in [
            r#"```json\n{"action":"none","reason":"unclear"}\n```"#,
            r#"{"action":"append","target":"x"}"#,
            r#"{"action":"create","target":"x","content":null,"id":"n1"}"#,
            r#"{"action":"none","reason":"unsupported"} trailing"#,
            r#"{"action":"delete","target":"x"}"#,
        ] {
            assert!(parse(bad, false).is_err(), "{bad}");
        }
        assert!(parse(r#"{"action":"none","reason":"unclear"}"#, true).is_err());
    }

    #[test]
    fn destructive_requests_are_refused_before_inference_and_several_steps_are_not() {
        assert_eq!(
            refusal("delete my work note"),
            Some(NoneReason::Destructive)
        );
        assert_eq!(refusal("create errands and then add milk to it"), None);
        assert_eq!(
            refusal("I watched Send Help last night, can you add it to my movies list"),
            None
        );
        assert_eq!(
            refusal("so yeah, remove everything from the groceries list"),
            Some(NoneReason::Destructive)
        );
        assert_eq!(
            refusal("put a bug about losing position in Attack FM"),
            None
        );
    }

    #[test]
    fn the_prompt_carries_titles_but_nothing_else_of_a_note() {
        let titles = vec!["Go".to_string(), "Movies\u{0}".to_string(), "  ".to_string()];
        assert_eq!(user_prompt("add Heat to movies", &titles), "Notes: Go; Movies\nSaid: add Heat to movies");
        assert_eq!(user_prompt("new note", &[]), "Notes: (none)\nSaid: new note");
    }

    #[test]
    fn voice_steps_ask_with_titles_and_kind_and_accept_only_whole_objects() {
        let titles = vec!["Movies".to_string()];
        assert_eq!(voice_prompt("add Heat", &titles, None), "Notes: Movies\nSaid: add Heat");
        assert_eq!(voice_prompt("add Heat", &titles, Some("add")), "Notes: Movies\nKind: add\nSaid: add Heat");
        assert!(check_answer(r#"{"kind":"add"}"#, false).is_ok());
        assert!(check_answer(r#"{"kind":"add"}"#, true).is_err());
        assert!(check_answer("add", false).is_err());
        assert!(check_answer(r#"["add"]"#, false).is_err());
    }

    #[test]
    fn the_worked_examples_are_answers_the_grammars_describe() {
        for system in [SORT_SYSTEM, PLAN_SYSTEM] {
            for line in system.lines().filter(|line| line.starts_with('{') && line.contains("\":")) {
                if line.starts_with("{\"kind\"") || line.starts_with("{\"actions\"") {
                    assert!(check_answer(line, false).is_ok(), "{line}");
                }
            }
        }
    }
}
