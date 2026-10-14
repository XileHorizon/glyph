//! A note's file name: its title, made safe for every file system a library
//! might be synced to (docs/LIBRARY.md).

/// The title the note's list shows: the first line of words, a heading's `#`s
/// gone, a picture line skipped. The same rule as the page's `noteTitle`.
pub fn title_of(body: &str) -> String {
    body.lines()
        .map(str::trim)
        .find(|line| !line.is_empty() && !is_picture_line(line))
        .map(plain)
        .unwrap_or_default()
}

/// A line's words without its Markdown: a heading's `#`s, a quote's `>`, a
/// list's or task's marker, a link's address (its words stay), a picture,
/// emphasis and code marks, and bare addresses. "- [ ] [Buy milk](https://…)
/// on the way home" is "Buy milk on the way home".
fn plain(line: &str) -> String {
    let mut text = line.trim_start_matches('#').trim_start().to_string();
    loop {
        let trimmed = text.trim_start();
        let next = trimmed
            .strip_prefix("> ")
            .or_else(|| trimmed.strip_prefix("- [ ] "))
            .or_else(|| trimmed.strip_prefix("- [x] "))
            .or_else(|| trimmed.strip_prefix("- [X] "))
            .or_else(|| trimmed.strip_prefix("- "))
            .or_else(|| trimmed.strip_prefix("* "))
            .or_else(|| trimmed.strip_prefix("+ "))
            .map(str::to_string)
            .or_else(|| {
                let digits = trimmed.chars().take_while(char::is_ascii_digit).count();
                (digits > 0 && digits < 4).then(|| trimmed[digits..].strip_prefix(". ").or_else(|| trimmed[digits..].strip_prefix(") ")).map(str::to_string)).flatten()
            });
        match next {
            Some(rest) => text = rest,
            None => break,
        }
    }
    let mut out = String::with_capacity(text.len());
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        // `![alt](src)` goes; `[words](href)` keeps its words.
        if c == '[' || (c == '!' && chars.get(i + 1) == Some(&'[')) {
            let open = if c == '!' { i + 1 } else { i };
            if let Some(close) = (open + 1..chars.len()).find(|&j| chars[j] == ']') {
                if chars.get(close + 1) == Some(&'(') {
                    if let Some(end) = (close + 2..chars.len()).find(|&j| chars[j] == ')') {
                        let words: String = chars[open + 1..close].iter().collect();
                        // An item's mark (`[notion](…)` at its end, docs/LIBRARY.md) names a plugin, not the note.
                        let mark = chars[end + 1..].iter().all(|ch| ch.is_whitespace()) && !words.is_empty() && words.chars().all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-');
                        if c != '!' && !mark {
                            out.push_str(&words);
                        }
                        i = end + 1;
                        continue;
                    }
                }
            }
        }
        if matches!(c, '*' | '_' | '`' | '~') {
            i += 1;
            continue;
        }
        out.push(c);
        i += 1;
    }
    out.split_whitespace()
        .filter(|word| !word.starts_with("http://") && !word.starts_with("https://") && !(word.starts_with('<') && word.ends_with('>')))
        .collect::<Vec<_>>()
        .join(" ")
}

fn is_picture_line(line: &str) -> bool {
    line.starts_with("![") && line.ends_with(')') && line.contains("](")
}

/// Most characters a file name keeps: long titles are cut at a word.
const MAX_STEM: usize = 80;

/// A title as a file name without its extension. Characters Windows, Android
/// or a sync service refuse are dropped, markdown emphasis goes, runs of space
/// shrink to one, and a trailing dot or space is trimmed (Windows can't hold
/// one). An empty result is "Untitled".
pub fn file_stem(title: &str) -> String {
    let cleaned: String = title
        .chars()
        .filter(|c| !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '#' | '^' | '[' | ']') && !c.is_control())
        .collect::<String>()
        .replace("**", "")
        .replace("__", "");
    let mut stem = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    if stem.chars().count() > MAX_STEM {
        let cut: String = stem.chars().take(MAX_STEM).collect();
        stem = match cut.rfind(' ') {
            Some(at) if at > MAX_STEM / 2 => cut[..at].to_string(),
            _ => cut,
        };
    }
    let stem = stem.trim_end_matches(['.', ' ']).trim_start_matches('.').trim().to_string();
    if stem.is_empty() { "Untitled".to_string() } else { stem }
}

/// The first of `Stem.md`, `Stem 2.md`, `Stem 3.md` … that `taken` says is free.
pub fn unique_name(stem: &str, mut taken: impl FnMut(&str) -> bool) -> String {
    let first = format!("{stem}.md");
    if !taken(&first) {
        return first;
    }
    (2..)
        .map(|n| format!("{stem} {n}.md"))
        .find(|name| !taken(name))
        .expect("an unbounded range finds a free name")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_title_is_the_first_line_of_words() {
        assert_eq!(title_of("\n![](image/a.jpg)\n# AttackFM bug bash\n\nFriday."), "AttackFM bug bash");
        assert_eq!(title_of("Call Sam about the cabin\nmore"), "Call Sam about the cabin");
        assert_eq!(title_of("   \n"), "");
    }

    #[test]
    fn the_title_drops_markdown_so_the_file_name_is_words() {
        assert_eq!(title_of("- [ ] [Buy milk](https://www.notion.so/attackfm/Buy-milk-1a2b) on the way home"), "Buy milk on the way home");
        assert_eq!(title_of("> **Bold** idea with `code` and ~~old~~"), "Bold idea with code and old");
        assert_eq!(title_of("1. First step <https://x.y> see https://example.com"), "First step see");
        assert_eq!(file_stem(&title_of("- [ ] buy milk [notion](https://www.notion.so/x)")), "buy milk", "a trailing item mark is not part of the name");
    }

    #[test]
    fn a_title_becomes_a_safe_file_name() {
        assert_eq!(file_stem("Bugs: the **big** list / v2?"), "Bugs the big list v2");
        assert_eq!(file_stem("..."), "Untitled");
        assert_eq!(file_stem("Ends with a dot."), "Ends with a dot");
        let long = "word ".repeat(40);
        let stem = file_stem(&long);
        assert!(stem.chars().count() <= MAX_STEM && !stem.ends_with(' '));
    }

    #[test]
    fn a_clash_gets_a_number() {
        let taken = ["Weekend trip.md", "Weekend trip 2.md"];
        assert_eq!(unique_name("Weekend trip", |n| taken.contains(&n)), "Weekend trip 3.md");
        assert_eq!(unique_name("New", |_| false), "New.md");
    }
}
