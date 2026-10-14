//! A web page's title, site name and summary, for the card under a link in a
//! note (Matt: "add link preview cards"). The page can't read another site's
//! HTML itself (the webview refuses a cross-origin read), so this reads it.
//!
//! - `link_preview({ url }) -> { url, title?, site?, description? }`
//!
//! Only `http` and `https`, a few redirects, eight seconds, and at most the
//! first half megabyte: the title and the `og:` tags are in the head, and a
//! video link is not downloaded to find them. Nothing is kept here; the page
//! caches what it is told. Native generation 17.

use serde::Serialize;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub site: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

/// How much of a page is read looking for its head.
#[cfg_attr(target_os = "ios", allow(dead_code))]
const MAX_BYTES: usize = 512 * 1024;
/// The longest title or summary kept, in characters.
const MAX_CHARS: usize = 300;

#[cfg(target_os = "ios")]
#[tauri::command]
pub async fn link_preview(_url: String) -> Result<Preview, String> {
    Err("Link previews are not available on iOS yet.".into())
}

#[cfg(not(target_os = "ios"))]
#[tauri::command]
pub async fn link_preview(url: String) -> Result<Preview, String> {
    let parsed = reqwest::Url::parse(url.trim()).map_err(|_| "That isn't a web address.".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("Only web pages have previews.".into());
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::limited(5))
        .user_agent("Mozilla/5.0 (compatible; GlyphLinkPreview/1.0)")
        .build()
        .map_err(|e| format!("cannot make an HTTP client: {e}"))?;
    let mut response = client
        .get(parsed.clone())
        .header("Accept", "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1")
        .send()
        .await
        .map_err(|_| "The page couldn't be reached.".to_string())?;
    if !response.status().is_success() {
        return Err(format!("The page answered {}.", response.status().as_u16()));
    }
    let html_like = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_none_or(|v| v.contains("html"));
    let site_host = response.url().host_str().map(str::to_string);
    let mut preview = Preview { url: response.url().to_string(), ..Preview::default() };
    if html_like {
        let mut body = Vec::new();
        while body.len() < MAX_BYTES {
            match response.chunk().await {
                Ok(Some(chunk)) => {
                    body.extend_from_slice(&chunk);
                    // The head is all that's wanted: stop once it has closed.
                    if contains_ci(&body, b"</head>") {
                        break;
                    }
                }
                Ok(None) => break,
                Err(_) => break,
            }
        }
        body.truncate(MAX_BYTES);
        preview = read_head(&String::from_utf8_lossy(&body), preview);
    }
    if preview.site.is_none() {
        preview.site = site_host.map(|h| h.trim_start_matches("www.").to_string());
    }
    Ok(preview)
}

#[cfg_attr(target_os = "ios", allow(dead_code))]
fn contains_ci(haystack: &[u8], needle: &[u8]) -> bool {
    haystack.windows(needle.len()).any(|w| w.eq_ignore_ascii_case(needle))
}

/// What a page's head says about it: `og:`/`twitter:` tags first, then `<title>` and the meta description.
pub fn read_head(html: &str, mut preview: Preview) -> Preview {
    let head = match find_ci(html, "</head>") {
        Some(end) => &html[..end],
        None => html,
    };
    let mut og_title = None;
    let mut og_site = None;
    let mut og_description = None;
    let mut description = None;
    let mut twitter_title = None;
    let mut rest = head;
    while let Some(at) = find_ci(rest, "<meta") {
        let after = &rest[at + 5..];
        let end = tag_end(after);
        let attrs = attributes(&after[..end]);
        let key = attrs.iter().find(|(k, _)| k == "property" || k == "name").map(|(_, v)| v.to_ascii_lowercase());
        let content = attrs.iter().find(|(k, _)| k == "content").map(|(_, v)| clean(v));
        if let (Some(key), Some(content)) = (key, content.filter(|c| !c.is_empty())) {
            match key.as_str() {
                "og:title" => og_title.get_or_insert(content),
                "og:site_name" => og_site.get_or_insert(content),
                "og:description" => og_description.get_or_insert(content),
                "description" => description.get_or_insert(content),
                "twitter:title" => twitter_title.get_or_insert(content),
                _ => &mut String::new(),
            };
        }
        rest = &after[end.min(after.len())..];
    }
    let title_tag = find_ci(head, "<title").and_then(|at| {
        let after = &head[at + 6..];
        let open = after.find('>')? + 1;
        let close = find_ci(&after[open..], "</title")?;
        Some(clean(&after[open..open + close]))
    });
    preview.title = og_title.or(twitter_title).or(title_tag).filter(|t| !t.is_empty());
    preview.site = og_site;
    preview.description = og_description.or(description);
    preview
}

fn find_ci(haystack: &str, needle: &str) -> Option<usize> {
    let bytes = haystack.as_bytes();
    let needle = needle.as_bytes();
    if needle.len() > bytes.len() {
        return None;
    }
    // ASCII needles only, so every match starts on a character boundary.
    (0..=bytes.len() - needle.len()).find(|&i| bytes[i..i + needle.len()].eq_ignore_ascii_case(needle))
}

/// Where a tag's `>` is, outside quotes.
fn tag_end(text: &str) -> usize {
    let mut quote = None;
    for (i, ch) in text.char_indices() {
        match (quote, ch) {
            (None, '"' | '\'') => quote = Some(ch),
            (Some(q), c) if c == q => quote = None,
            (None, '>') => return i,
            _ => {}
        }
    }
    text.len()
}

/// A tag's attributes, names lower-cased.
fn attributes(text: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        while i < chars.len() && (chars[i].is_whitespace() || chars[i] == '/') {
            i += 1;
        }
        let start = i;
        while i < chars.len() && !chars[i].is_whitespace() && chars[i] != '=' && chars[i] != '/' {
            i += 1;
        }
        let name: String = chars[start..i].iter().collect::<String>().to_ascii_lowercase();
        while i < chars.len() && chars[i].is_whitespace() {
            i += 1;
        }
        let mut value = String::new();
        if i < chars.len() && chars[i] == '=' {
            i += 1;
            while i < chars.len() && chars[i].is_whitespace() {
                i += 1;
            }
            if i < chars.len() && (chars[i] == '"' || chars[i] == '\'') {
                let q = chars[i];
                i += 1;
                let from = i;
                while i < chars.len() && chars[i] != q {
                    i += 1;
                }
                value = chars[from..i].iter().collect();
                i += 1;
            } else {
                let from = i;
                while i < chars.len() && !chars[i].is_whitespace() {
                    i += 1;
                }
                value = chars[from..i].iter().collect();
            }
        }
        if !name.is_empty() {
            out.push((name, value));
        } else if i == start {
            i += 1;
        }
    }
    out
}

/// Entities decoded, whitespace collapsed, and the length capped.
fn clean(text: &str) -> String {
    let decoded = decode_entities(text);
    let collapsed = decoded.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.chars().count() > MAX_CHARS {
        let cut: String = collapsed.chars().take(MAX_CHARS - 1).collect();
        format!("{}…", cut.trim_end())
    } else {
        collapsed
    }
}

fn decode_entities(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find('&') {
        out.push_str(&rest[..at]);
        let tail = &rest[at..];
        let Some(semi) = tail[..tail.len().min(12)].find(';') else {
            out.push('&');
            rest = &tail[1..];
            continue;
        };
        let name = &tail[1..semi];
        let decoded = match name {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" | "#39" => Some('\''),
            "nbsp" => Some(' '),
            "mdash" => Some('—'),
            "ndash" => Some('–'),
            "hellip" => Some('…'),
            _ if name.starts_with("#x") || name.starts_with("#X") => u32::from_str_radix(&name[2..], 16).ok().and_then(char::from_u32),
            _ if name.starts_with('#') => name[1..].parse::<u32>().ok().and_then(char::from_u32),
            _ => None,
        };
        match decoded {
            Some(ch) => {
                out.push(ch);
                rest = &tail[semi + 1..];
            }
            None => {
                out.push('&');
                rest = &tail[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn head(html: &str) -> Preview {
        read_head(html, Preview { url: "https://x.dev".into(), ..Preview::default() })
    }

    #[test]
    fn prefers_open_graph_and_falls_back_to_the_title() {
        let page = r#"<html><head><title>Plain &amp; simple</title>
            <meta property="og:title" content="The  Cabin&#39;s Page">
            <META NAME='description' content="A place &mdash; in the woods">
            <meta property="og:site_name" content=Airbnb></head><body><title>not this</title></body>"#;
        let p = head(page);
        assert_eq!(p.title.as_deref(), Some("The Cabin's Page"));
        assert_eq!(p.site.as_deref(), Some("Airbnb"));
        assert_eq!(p.description.as_deref(), Some("A place — in the woods"));

        let bare = head("<head><title>\n  Just a title \n</title></head>");
        assert_eq!(bare.title.as_deref(), Some("Just a title"));
        assert_eq!(bare.site, None);
        assert_eq!(bare.description, None);
    }

    #[test]
    fn copes_with_odd_markup_and_long_text() {
        let p = head(r#"<meta content="Content first" property="og:title"/><meta name="description" content="">"#);
        assert_eq!(p.title.as_deref(), Some("Content first"));
        assert_eq!(p.description, None, "an empty description is none");
        let long = format!("<title>{}</title>", "word ".repeat(200));
        assert!(head(&long).title.unwrap().chars().count() <= MAX_CHARS);
        assert_eq!(head("<p>no head at all").title, None);
        assert_eq!(decode_entities("a & b &unknown; &#x1F389;"), "a & b &unknown; 🎉");
    }
}

#[cfg(all(test, not(target_os = "ios")))]
mod live {
    /// Reads a real page. Run by hand: `cargo test --lib link_preview::live -- --ignored`.
    #[test]
    #[ignore]
    fn reads_a_real_page() {
        let preview = tauri::async_runtime::block_on(super::link_preview("https://github.com/tauri-apps/tauri".into())).unwrap();
        eprintln!("{preview:?}");
        assert!(preview.title.is_some());
    }
}
