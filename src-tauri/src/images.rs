//! Pictures in notes: where they are kept, how the page loads them, and when
//! they go.
//!
//! A note refers to a picture as `![](image/<name>)` on a line of its own. The
//! file is `<app_data_dir>/images/<name>`, named by a v4 uuid when it arrives,
//! so a name never changes and can be cached for good. The Android shell picks
//! and downsizes a photo into `<app_cache_dir>/picked/`; `save_image` adopts it
//! from there, and nowhere else. A pasted picture has no file: the page shrinks
//! it in a canvas and hands the bytes to `save_image_data`, which keeps them
//! only if they start like a JPEG, PNG or WebP. The page shows either through
//! the `img` scheme, `http://img.localhost/<name>`.
//!
//! Every name that reaches a path is checked first: letters, digits, `_` and
//! `-`, then one image extension. A name comes from the page, and one that is
//! not that - a slash, a `..` - must never name a file to read or delete.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::Manager;

/// The URI scheme the page loads pictures through.
pub const SCHEME: &str = "img";

/// The largest picture adopted. The shell writes JPEGs of at most 1600 px at
/// quality 85, well under a megabyte; this only refuses something that is not
/// one of those.
const MAX_BYTES: u64 = 25 * 1024 * 1024;

const EXTENSIONS: [&str; 4] = ["jpg", "jpeg", "png", "webp"];

/// Whether `name` is a picture name this module will turn into a path.
pub fn valid_name(name: &str) -> bool {
    let Some((stem, extension)) = name.rsplit_once('.') else { return false };
    !stem.is_empty()
        && stem.len() <= 64
        && stem.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        && EXTENSIONS.contains(&extension)
}

fn content_type(name: &str) -> &'static str {
    match name.rsplit_once('.').map(|(_, e)| e) {
        Some("png") => "image/png",
        Some("webp") => "image/webp",
        _ => "image/jpeg",
    }
}

/// The picture names a note's body refers to, as `![alt](image/<name>)`, in
/// order, without repeats. Names that are not valid are skipped.
pub fn referenced(body: &str) -> Vec<String> {
    let mut names = Vec::new();
    let mut rest = body;
    while let Some(at) = rest.find("![") {
        rest = &rest[at + 2..];
        let Some(close) = rest.find("](image/") else { continue };
        // The alt text may not hold a `]`, the same as the page's pattern.
        if rest[..close].contains(']') {
            continue;
        }
        let after = &rest[close + "](image/".len()..];
        let Some(end) = after.find(')') else { continue };
        let name = &after[..end];
        if valid_name(name) && !names.iter().any(|n| n == name) {
            names.push(name.to_string());
        }
        rest = &after[end..];
    }
    names
}

/// `<app_data_dir>/images`, where pictures live. Shared with the reset.
pub(crate) fn images_dir<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|dir| dir.join("images"))
}

/// Moves a picked picture from `picked` into `images` under a fresh name, and
/// answers the name. Refuses any path that is not a file directly inside
/// `picked` once both are canonicalised - so a symlink or a `..` cannot
/// adopt a file from elsewhere - and anything that is not an image by
/// extension, or is empty or too large.
pub fn adopt(picked: &Path, images: &Path, path: &Path) -> Result<String, String> {
    let refuse = || "That picture could not be added.".to_string();
    let picked = picked.canonicalize().map_err(|_| refuse())?;
    let file = path.canonicalize().map_err(|_| refuse())?;
    if file.parent() != Some(picked.as_path()) {
        return Err(refuse());
    }
    let extension = file
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .filter(|e| EXTENSIONS.contains(&e.as_str()))
        .ok_or_else(refuse)?;
    let size = std::fs::metadata(&file).map_err(|_| refuse())?.len();
    if size == 0 || size > MAX_BYTES {
        return Err(refuse());
    }
    std::fs::create_dir_all(images).map_err(|e| format!("There is no room to keep pictures: {e}"))?;
    let name = format!("{}.{}", uuid::Uuid::new_v4(), if extension == "jpeg" { "jpg" } else { &extension });
    let target = images.join(&name);
    // A rename where it can be; the cache and the data directory can be on
    // different mounts, and then it is a copy and a delete.
    if std::fs::rename(&file, &target).is_err() {
        std::fs::copy(&file, &target).map_err(|e| format!("The picture could not be saved: {e}"))?;
        let _ = std::fs::remove_file(&file);
    }
    Ok(name)
}

/// The extension a picture's first bytes say it is: JPEG, PNG or WebP, and
/// nothing else. The bytes, not what the page says they are.
fn kind(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("jpg")
    } else if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("png")
    } else if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        Some("webp")
    } else {
        None
    }
}

/// Base64 from the page, as plain base64 or a whole `data:` URL. Refused
/// before decoding when it could only decode to more than `MAX_BYTES`.
fn decode(text: &str) -> Result<Vec<u8>, String> {
    use base64::Engine as _;
    let text = text.split_once(";base64,").map_or(text, |(_, data)| data).trim();
    if text.len() as u64 > MAX_BYTES / 3 * 4 + 4 {
        return Err("That picture is too big to add.".to_string());
    }
    base64::engine::general_purpose::STANDARD
        .decode(text)
        .map_err(|_| "That picture could not be added.".to_string())
}

/// Keeps a picture's bytes in `images` under a fresh name, and answers the
/// name. The extension comes from the bytes. Written to a hidden `.part` file
/// and renamed, so a picture is whole or not there; a `.part` is never a valid
/// name, so the scheme never serves one half written.
pub fn keep(images: &Path, bytes: &[u8]) -> Result<String, String> {
    if bytes.len() as u64 > MAX_BYTES {
        return Err("That picture is too big to add.".to_string());
    }
    let extension = kind(bytes).ok_or_else(|| "That is not a picture Glyph can add.".to_string())?;
    std::fs::create_dir_all(images).map_err(|e| format!("There is no room to keep pictures: {e}"))?;
    let id = uuid::Uuid::new_v4();
    let name = format!("{id}.{extension}");
    let part = images.join(format!(".{id}.part"));
    let written = (|| {
        use std::io::Write as _;
        let mut file = std::fs::File::create(&part)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        std::fs::rename(&part, images.join(&name))
    })();
    if let Err(e) = written {
        let _ = std::fs::remove_file(&part);
        return Err(format!("The picture could not be saved: {e}"));
    }
    Ok(name)
}

/// Keeps a picture that arrived by sync under the name it already has on the
/// device it came from, which is the name its notes refer to it by. The bytes
/// still have to be a picture, and of the kind the name says.
pub fn place(images: &Path, name: &str, base64: &str) -> Result<(), String> {
    if !valid_name(name) {
        return Err("That is not a picture name.".to_string());
    }
    let bytes = decode(base64)?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("That picture is too big to add.".to_string());
    }
    let extension = name.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
    let said = kind(&bytes).ok_or_else(|| "That is not a picture Glyph can add.".to_string())?;
    if said != extension && !(said == "jpg" && extension == "jpeg") {
        return Err("That picture is not what its name says.".to_string());
    }
    std::fs::create_dir_all(images).map_err(|e| format!("There is no room to keep pictures: {e}"))?;
    let part = images.join(format!(".{name}.part"));
    std::fs::write(&part, &bytes).and_then(|()| std::fs::rename(&part, images.join(name))).map_err(|e| {
        let _ = std::fs::remove_file(&part);
        format!("The picture could not be saved: {e}")
    })
}

#[derive(Debug, Clone, Serialize)]
pub struct SavedImage {
    pub name: String,
}

/// Adopts a picture the Android shell picked into `<app_cache_dir>/picked/`,
/// and answers its name for `![](image/<name>)`. Native generation 8.
#[tauri::command]
pub fn save_image(app: tauri::AppHandle, path: String) -> Result<SavedImage, String> {
    let picked = app
        .path()
        .app_cache_dir()
        .map(|dir| dir.join("picked"))
        .map_err(|_| "That picture could not be added.".to_string())?;
    let images = images_dir(&app).ok_or_else(|| "There is no room to keep pictures.".to_string())?;
    adopt(&picked, &images, Path::new(&path)).map(|name| SavedImage { name })
}

/// Keeps a pasted picture the page has already shrunk, sent as base64, and
/// answers its name for `![](image/<name>)`. Off the main thread: a few
/// hundred KB to decode and write is not a frame's work. Native generation 9.
#[tauri::command(async)]
pub fn save_image_data(app: tauri::AppHandle, base64: String) -> Result<SavedImage, String> {
    let bytes = decode(&base64)?;
    let images = images_dir(&app).ok_or_else(|| "There is no room to keep pictures.".to_string())?;
    keep(&images, &bytes).map(|name| SavedImage { name })
}

/// Removes the pictures a deleted note referred to, unless another note still
/// does. Best effort: a picture that cannot be removed is left, and the delete
/// it follows has already happened.
pub fn remove_unreferenced<R: tauri::Runtime>(app: &tauri::AppHandle<R>, store: &crate::library::Library, body: &str) {
    let Some(dir) = images_dir(app) else { return };
    for name in referenced(body) {
        if store.image_in_use(&name).unwrap_or(true) {
            continue;
        }
        let _ = std::fs::remove_file(dir.join(&name));
    }
}

/// Serves `<app_data_dir>/images/<name>` to the page. Names are uuids that
/// never change, so the answer can be cached for good.
pub fn serve<R: tauri::Runtime>(app: &tauri::AppHandle<R>, request: &tauri::http::Request<Vec<u8>>) -> tauri::http::Response<Vec<u8>> {
    use tauri::http::{header, Response, StatusCode};
    let name = request.uri().path().trim_start_matches('/');
    let bytes = valid_name(name)
        .then(|| images_dir(app))
        .flatten()
        .and_then(|dir| std::fs::read(dir.join(name)).ok());
    let builder = Response::builder().header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*");
    let response = match bytes {
        Some(bytes) => builder
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, content_type(name))
            .header(header::CACHE_CONTROL, "public, max-age=31536000, immutable")
            .header(header::CONTENT_LENGTH, bytes.len().to_string())
            .body(bytes),
        None => builder.status(StatusCode::NOT_FOUND).body(Vec::new()),
    };
    response.unwrap_or_else(|_| Response::new(Vec::new()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("glyph-images-{label}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn only_plain_image_names_are_names() {
        for name in ["0f8e7c1a-uuid.jpg", "a_b.png", "x.webp", "photo.jpeg"] {
            assert!(valid_name(name), "{name}");
        }
        for name in ["", ".jpg", "../x.jpg", "a/b.jpg", "a.gif", "a.JPG", "a.jpg.exe", "a b.jpg", "a.", "a"] {
            assert!(!valid_name(name), "{name}");
        }
    }

    #[test]
    fn finds_every_picture_a_note_refers_to_once() {
        let body = "# Trip\n\n![](image/a1.jpg)\nText ![a view](image/b-2.png) and ![](image/a1.jpg) again.\n![](image/../x.jpg)\n![no](http://x/y.jpg)\n![broken](image/c.jpg";
        assert_eq!(referenced(body), ["a1.jpg", "b-2.png"]);
        assert!(referenced("no pictures here").is_empty());
    }

    #[test]
    fn only_jpeg_png_and_webp_bytes_are_pictures() {
        assert_eq!(kind(&[0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10]), Some("jpg"));
        assert_eq!(kind(b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR"), Some("png"));
        assert_eq!(kind(b"RIFF\x24\0\0\0WEBPVP8 "), Some("webp"));
        for bytes in [&b""[..], b"\xFF\xD8", b"GIF89a", b"RIFF\x24\0\0\0WAVEfmt ", b"RIFF", b"<svg xmlns=", b"\x89PNG\r\n"] {
            assert_eq!(kind(bytes), None, "{bytes:?}");
        }
    }

    #[test]
    fn pasted_bytes_are_kept_whole_under_a_name_from_their_kind() {
        use base64::Engine as _;
        let images = temp("pasted");
        let png = b"\x89PNG\r\n\x1a\n and the rest of a picture".to_vec();
        let text = base64::engine::general_purpose::STANDARD.encode(&png);

        // Plain base64, and the same as a data URL.
        for sent in [text.clone(), format!("data:image/png;base64,{text}")] {
            let name = keep(&images, &decode(&sent).unwrap()).unwrap();
            assert!(valid_name(&name) && name.ends_with(".png"), "{name}");
            assert_eq!(std::fs::read(images.join(&name)).unwrap(), png);
        }
        let left: Vec<_> = std::fs::read_dir(&images).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(left.len(), 2, "no .part left behind: {left:?}");

        // Not base64, not a picture, and too big: refused, and nothing written.
        assert!(decode("not base64 at all!").is_err());
        assert!(keep(&images, b"GIF89a....").is_err());
        let mut huge = vec![0u8; MAX_BYTES as usize + 1];
        huge[..3].copy_from_slice(&[0xFF, 0xD8, 0xFF]);
        assert!(keep(&images, &huge).is_err());
        assert!(decode(&"A".repeat((MAX_BYTES / 3 * 4 + 8) as usize)).is_err());
        assert_eq!(std::fs::read_dir(&images).unwrap().count(), 2);
        let _ = std::fs::remove_dir_all(images);
    }

    #[test]
    fn a_synced_picture_keeps_its_name_only_if_it_is_what_the_name_says() {
        use base64::Engine as _;
        let dir = temp("place");
        let jpeg = base64::engine::general_purpose::STANDARD.encode([0xFF, 0xD8, 0xFF, 0xE0, 1, 2]);
        place(&dir, "abc.jpg", &jpeg).unwrap();
        assert_eq!(std::fs::read(dir.join("abc.jpg")).unwrap(), vec![0xFF, 0xD8, 0xFF, 0xE0, 1, 2]);
        assert!(place(&dir, "abc.png", &jpeg).is_err(), "a JPEG named as a PNG");
        assert!(place(&dir, "../abc.jpg", &jpeg).is_err());
        let text = base64::engine::general_purpose::STANDARD.encode(b"hello");
        assert!(place(&dir, "t.jpg", &text).is_err());
    }

    #[test]
    fn a_picked_picture_is_adopted_under_a_new_name() {
        let (picked, images) = (temp("picked"), temp("images"));
        let file = picked.join("pick-1.jpeg");
        std::fs::write(&file, b"jpeg bytes").unwrap();
        let name = adopt(&picked, &images, &file).unwrap();
        assert!(valid_name(&name) && name.ends_with(".jpg"), "{name}");
        assert_eq!(std::fs::read(images.join(&name)).unwrap(), b"jpeg bytes");
        assert!(!file.exists(), "moved, not copied");
        let _ = (std::fs::remove_dir_all(picked), std::fs::remove_dir_all(images));
    }

    #[test]
    fn nothing_outside_the_picked_folder_is_adopted() {
        let (picked, images, elsewhere) = (temp("picked"), temp("images"), temp("elsewhere"));
        let outside = elsewhere.join("secret.jpg");
        std::fs::write(&outside, b"x").unwrap();
        // Directly, through `..`, and through a symlink inside the folder.
        assert!(adopt(&picked, &images, &outside).is_err());
        assert!(adopt(&picked, &images, &picked.join("../").join(elsewhere.file_name().unwrap()).join("secret.jpg")).is_err());
        #[cfg(unix)]
        {
            let link = picked.join("link.jpg");
            std::os::unix::fs::symlink(&outside, &link).unwrap();
            assert!(adopt(&picked, &images, &link).is_err());
        }
        // Not an image, and empty.
        std::fs::write(picked.join("notes.txt"), b"x").unwrap();
        assert!(adopt(&picked, &images, &picked.join("notes.txt")).is_err());
        std::fs::write(picked.join("empty.jpg"), b"").unwrap();
        assert!(adopt(&picked, &images, &picked.join("empty.jpg")).is_err());
        assert!(outside.exists());
        let _ = (std::fs::remove_dir_all(picked), std::fs::remove_dir_all(images), std::fs::remove_dir_all(elsewhere));
    }
}
