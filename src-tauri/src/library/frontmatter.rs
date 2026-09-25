//! A note's front matter: the YAML block at the top of the file, as Obsidian's
//! Properties write it (docs/LIBRARY.md).
//!
//! Not a YAML library, on purpose. A library would parse the block into values
//! and write it back out in its own style: reordered keys, requoted strings,
//! comments gone. That rewrites a person's file every time Glyph pins a note.
//! This keeps the block as its lines. Reading picks out the few top-level keys
//! Glyph knows (plain, quoted, `true`/`false`, `[flow, lists]` and `- block`
//! lists). Writing replaces only the lines of a key whose value changes, and
//! appends a key that wasn't there. Everything else (unknown keys, nested maps,
//! comments, blank lines, the person's quoting) comes back byte for byte.

/// A value Glyph reads or writes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Value {
    Text(String),
    Bool(bool),
    List(Vec<String>),
}

impl Value {
    pub fn as_text(&self) -> Option<&str> {
        match self {
            Value::Text(text) => Some(text),
            _ => None,
        }
    }
}

/// The block's lines, without the `---` fences.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct FrontMatter {
    lines: Vec<String>,
}

/// A file split into its front matter (if it has one) and its body.
///
/// A block is only front matter when the file STARTS with `---` on its own line
/// and a closing `---` (or `...`) follows. A `---` further down is a
/// thematic break in the body, not metadata.
pub fn split(text: &str) -> (Option<FrontMatter>, &str) {
    let rest = text.strip_prefix('\u{feff}').unwrap_or(text);
    let Some(after) = rest.strip_prefix("---\n").or_else(|| rest.strip_prefix("---\r\n")) else {
        return (None, text);
    };
    let mut offset = 0;
    for line in after.split_inclusive('\n') {
        let bare = line.trim_end_matches(['\n', '\r']);
        if bare == "---" || bare == "..." {
            let block = &after[..offset];
            let body = &after[offset + line.len()..];
            let lines = block.split('\n').map(|l| l.trim_end_matches('\r').to_string()).collect::<Vec<_>>();
            // `split` leaves an empty last piece after the final newline; it isn't a line.
            let lines = match lines.last() {
                Some(last) if last.is_empty() && block.ends_with('\n') => lines[..lines.len() - 1].to_vec(),
                _ => lines,
            };
            return (Some(FrontMatter { lines }), body);
        }
        offset += line.len();
    }
    (None, text)
}

/// The front matter and body joined back into a file. No front matter, or an empty one, is no block.
pub fn join(front: Option<&FrontMatter>, body: &str) -> String {
    match front {
        Some(front) if !front.lines.iter().all(|l| l.trim().is_empty()) => format!("---\n{}\n---\n{}", front.lines.join("\n"), body),
        _ => body.to_string(),
    }
}

/// A top-level key on this line, if it starts one: `key:` at column 0, not a comment or list item.
fn key_of(line: &str) -> Option<&str> {
    if line.starts_with([' ', '\t', '#', '-']) || line.is_empty() {
        return None;
    }
    let colon = line.find(':')?;
    let key = line[..colon].trim();
    let after = &line[colon + 1..];
    (!key.is_empty() && (after.is_empty() || after.starts_with([' ', '\t']))).then_some(key)
}

fn unquote(raw: &str) -> String {
    let raw = raw.trim();
    if raw.len() >= 2 && ((raw.starts_with('"') && raw.ends_with('"')) || (raw.starts_with('\'') && raw.ends_with('\''))) {
        let inner = &raw[1..raw.len() - 1];
        return if raw.starts_with('"') { inner.replace("\\\"", "\"").replace("\\\\", "\\") } else { inner.replace("''", "'") };
    }
    raw.to_string()
}

/// A scalar's text with a trailing `# comment` gone (only outside quotes).
fn without_comment(raw: &str) -> &str {
    let trimmed = raw.trim_start();
    if trimmed.starts_with('"') || trimmed.starts_with('\'') {
        return raw;
    }
    match raw.find(" #") {
        Some(at) => &raw[..at],
        None => raw,
    }
}

fn needs_quotes(text: &str) -> bool {
    text.is_empty()
        || text.trim() != text
        || text.contains(": ")
        || text.contains(" #")
        || text.starts_with(['[', ']', '{', '}', '#', '&', '*', '!', '|', '>', '\'', '"', '%', '@', '`', '-', '?', ','])
        || matches!(text.to_ascii_lowercase().as_str(), "true" | "false" | "yes" | "no" | "null" | "~")
}

fn render_text(text: &str) -> String {
    if needs_quotes(text) {
        format!("\"{}\"", text.replace('\\', "\\\\").replace('"', "\\\""))
    } else {
        text.to_string()
    }
}

impl FrontMatter {
    pub fn new() -> FrontMatter {
        FrontMatter::default()
    }

    /// Where `key`'s lines are: its own line, and any indented or `- item` lines under it.
    fn span(&self, key: &str) -> Option<(usize, usize)> {
        let start = self.lines.iter().position(|line| key_of(line) == Some(key))?;
        let mut end = start + 1;
        while end < self.lines.len() && key_of(&self.lines[end]).is_none() && !self.lines[end].is_empty() && (self.lines[end].starts_with([' ', '\t', '-'])) {
            end += 1;
        }
        Some((start, end))
    }

    /// The value of a top-level key Glyph can read, or None (absent, empty, or a shape it doesn't read).
    pub fn get(&self, key: &str) -> Option<Value> {
        let (start, end) = self.span(key)?;
        let line = &self.lines[start];
        let raw = without_comment(&line[line.find(':')? + 1..]).trim();
        if raw.is_empty() {
            let items: Vec<String> = self.lines[start + 1..end]
                .iter()
                .filter_map(|l| l.trim_start().strip_prefix('-').map(|item| unquote(without_comment(item))))
                .filter(|item| !item.is_empty())
                .collect();
            return (!items.is_empty()).then_some(Value::List(items));
        }
        if raw.starts_with('[') && raw.ends_with(']') {
            let items = raw[1..raw.len() - 1].split(',').map(unquote).filter(|item| !item.is_empty()).collect();
            return Some(Value::List(items));
        }
        match raw {
            "true" | "True" | "TRUE" => Some(Value::Bool(true)),
            "false" | "False" | "FALSE" => Some(Value::Bool(false)),
            _ => Some(Value::Text(unquote(raw))),
        }
    }

    pub fn text(&self, key: &str) -> Option<String> {
        match self.get(key)? {
            Value::Text(text) => Some(text),
            Value::Bool(b) => Some(b.to_string()),
            Value::List(_) => None,
        }
    }

    pub fn flag(&self, key: &str) -> bool {
        matches!(self.get(key), Some(Value::Bool(true)))
    }

    /// Sets a key, or removes it with None. A key whose value is already this is left exactly as written.
    pub fn set(&mut self, key: &str, value: Option<Value>) {
        if self.get(key) == value && (value.is_some() || self.span(key).is_none()) {
            return;
        }
        let rendered = value.map(|value| match value {
            Value::Text(text) => vec![format!("{key}: {}", render_text(&text))],
            Value::Bool(b) => vec![format!("{key}: {b}")],
            Value::List(items) if items.is_empty() => vec![format!("{key}: []")],
            Value::List(items) => vec![format!("{key}: [{}]", items.iter().map(|i| render_text(i)).collect::<Vec<_>>().join(", "))],
        });
        match (self.span(key), rendered) {
            (Some((start, end)), Some(lines)) => {
                self.lines.splice(start..end, lines);
            }
            (Some((start, end)), None) => {
                self.lines.drain(start..end);
            }
            (None, Some(lines)) => self.lines.extend(lines),
            (None, None) => {}
        }
    }

    pub fn is_empty(&self) -> bool {
        self.lines.iter().all(|l| l.trim().is_empty())
    }

    /// Whether every line is one of `keys` set on one line: nothing else, no
    /// list below a key, no comment the person wrote.
    pub fn only(&self, keys: &[&str]) -> bool {
        self.lines.iter().filter(|l| !l.trim().is_empty()).all(|l| {
            !l.starts_with([' ', '\t', '#']) && l.split_once(':').is_some_and(|(key, _)| keys.contains(&key.trim()))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const OBSIDIAN: &str = "---\nid: 7c1e\ncreated: 2026-09-14T10:32:10.123Z\n# a comment the person wrote\ntags:\n  - bugbash\n  - \"android\"\naliases: [Bug bash, 'The bash']\ncover:\n  image: a.png\n  alt: A picture\npinned: true\n---\n# AttackFM\n\n---\n\nA break above.\n";

    #[test]
    fn reads_the_keys_obsidian_writes() {
        let (front, body) = split(OBSIDIAN);
        let front = front.expect("front matter");
        assert_eq!(front.text("id").as_deref(), Some("7c1e"));
        assert_eq!(front.get("tags"), Some(Value::List(vec!["bugbash".into(), "android".into()])));
        assert_eq!(front.get("aliases"), Some(Value::List(vec!["Bug bash".into(), "The bash".into()])));
        assert!(front.flag("pinned"));
        assert_eq!(front.get("cover"), None, "a nested map isn't a shape Glyph reads");
        assert!(body.starts_with("# AttackFM\n\n---\n"), "a later --- is the body's thematic break");
    }

    #[test]
    fn writing_changes_only_the_keys_that_changed_and_keeps_everything_else() {
        let (front, body) = split(OBSIDIAN);
        let mut front = front.unwrap();
        front.set("pinned", Some(Value::Bool(true)));
        assert_eq!(join(Some(&front), body), OBSIDIAN, "setting a value it already has rewrites nothing");
        front.set("pinned", None);
        front.set("archived", Some(Value::Text("2026-09-15T08:00:00.000Z".into())));
        front.set("tags", Some(Value::List(vec!["bugbash".into()])));
        let out = join(Some(&front), body);
        assert!(out.contains("# a comment the person wrote\ntags: [bugbash]\naliases: [Bug bash, 'The bash']\ncover:\n  image: a.png\n  alt: A picture\n"));
        assert!(!out.contains("pinned"));
        assert!(out.contains("archived: 2026-09-15T08:00:00.000Z\n---\n# AttackFM"));
    }

    #[test]
    fn a_file_without_front_matter_is_all_body_and_gets_a_block_only_when_needed() {
        let (front, body) = split("# Plain\n\n---\nnot metadata\n");
        assert!(front.is_none());
        assert_eq!(body, "# Plain\n\n---\nnot metadata\n");
        assert_eq!(join(Some(&FrontMatter::new()), body), body);
        let mut fresh = FrontMatter::new();
        fresh.set("id", Some(Value::Text("n1".into())));
        assert_eq!(join(Some(&fresh), "# Plain\n"), "---\nid: n1\n---\n# Plain\n");
    }

    #[test]
    fn quotes_what_yaml_would_misread() {
        let mut front = FrontMatter::new();
        front.set("notion-board", Some(Value::Text("https://www.notion.so/abc".into())));
        front.set("title", Some(Value::Text("Bugs: the list".into())));
        front.set("answer", Some(Value::Text("yes".into())));
        let out = join(Some(&front), "");
        assert!(out.contains("notion-board: https://www.notion.so/abc\n"));
        assert!(out.contains("title: \"Bugs: the list\"\n"));
        assert!(out.contains("answer: \"yes\"\n"));
        let (again, _) = split(&out);
        assert_eq!(again.unwrap().text("title").as_deref(), Some("Bugs: the list"));
    }

    #[test]
    fn an_unclosed_block_is_body_and_windows_line_ends_are_read() {
        assert!(split("---\nid: x\nno close\n").0.is_none());
        let (front, body) = split("---\r\nid: w\r\n---\r\nBody\r\n");
        assert_eq!(front.unwrap().text("id").as_deref(), Some("w"));
        assert_eq!(body, "Body\r\n");
    }
}
