//! Download + decrypt orchestration with bounded memory and atomic, fail-closed
//! writes.
//!
//! Flow: S3 `GetObject` body (async) → `SyncIoBridge` → age streaming decrypt
//! (sync, on a blocking worker) → `BufWriter` to a temp file in the destination
//! directory → `fsync` → atomic `rename` to the final name. On ANY error the
//! temp file is removed, so a wrong key or corrupt object never yields a
//! partial or plaintext file.

use std::borrow::Cow;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use aws_sdk_s3::Client;
use tokio_util::io::SyncIoBridge;

use crate::crypto::{self, Identity};
use crate::error::{AppError, AppResult};

static TMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Download `key` from `bucket`, decrypt it, and atomically write the plaintext
/// to `dest_path`. `progress(done, total)` is called as plaintext bytes land;
/// `total` is the *ciphertext* content length (a close-enough size hint).
pub async fn download_and_decrypt(
    client: &Client,
    bucket: &str,
    key: &str,
    dest_path: &Path,
    identities: Arc<Vec<Identity>>,
    progress: impl Fn(u64, u64) + Send + 'static,
) -> AppResult<u64> {
    let resp = client
        .get_object()
        .bucket(bucket)
        .key(key)
        .send()
        .await
        .map_err(|e| AppError::S3(crate::s3::friendly_s3(&e)))?;

    let total = resp.content_length().unwrap_or(0).max(0) as u64;
    let body = resp.body.into_async_read();

    // Temp file lives next to the destination so the rename stays on one volume.
    let counter = TMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let file_name = dest_path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("download");
    let tmp_path = dest_path.with_file_name(format!(".{file_name}.occ-part{counter}"));

    // `.age` objects are decrypted; everything else is passed through unchanged.
    let decrypt = key.to_ascii_lowercase().ends_with(".age");

    let mut bridge = SyncIoBridge::new(body);
    let dest = dest_path.to_path_buf();
    let tmp = tmp_path.clone();

    let result = tokio::task::spawn_blocking(move || -> AppResult<u64> {
        // Use extended-length paths for the actual fs calls so deep S3 prefixes
        // don't trip the Windows MAX_PATH limit (no-op on other platforms).
        let dest_fs = fs_path(&dest);
        let tmp_fs = fs_path(&tmp);
        if let Some(parent) = dest_fs.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let file = std::fs::File::create(&tmp_fs)?;
        let mut writer = std::io::BufWriter::new(file);

        let written = if decrypt {
            crypto::decrypt_stream(bridge, &mut writer, &identities, |done| {
                progress(done, total)
            })?
        } else {
            copy_stream(&mut bridge, &mut writer, |done| progress(done, total))?
        };

        let file = writer
            .into_inner()
            .map_err(|e| AppError::Io(e.to_string()))?;
        file.sync_all()?;
        std::fs::rename(&tmp_fs, &dest_fs)?;
        Ok(written)
    })
    .await
    .map_err(|e| AppError::Other(format!("Internal task error: {e}")))?;

    if result.is_err() {
        // Fail-closed: leave nothing behind.
        let _ = std::fs::remove_file(fs_path(&tmp_path));
    }
    result
}

/// Stream-copy `src` to `dst` in 64 KiB chunks, reporting progress. Used for
/// non-`.age` objects (passed through unchanged, no decryption).
fn copy_stream<R: std::io::Read, W: std::io::Write>(
    src: &mut R,
    dst: &mut W,
    mut on_progress: impl FnMut(u64),
) -> AppResult<u64> {
    let mut buf = vec![0u8; 64 * 1024];
    let mut total: u64 = 0;
    loop {
        let n = src
            .read(&mut buf)
            .map_err(|e| AppError::Io(e.to_string()))?;
        if n == 0 {
            break;
        }
        dst.write_all(&buf[..n])?;
        total += n as u64;
        on_progress(total);
    }
    dst.flush()?;
    Ok(total)
}

/// Characters that are illegal in Windows file names but perfectly legal in S3
/// object keys (e.g. the `:` in an ISO-8601 timestamp prefix). `/` and `\` are
/// handled separately as path separators.
const WIN_ILLEGAL: &[char] = &['<', '>', ':', '"', '|', '?', '*'];

/// True if `stem` (the part before the first `.`) is a reserved Windows device
/// name — creating such a file fails or, worse, targets a device.
fn is_windows_reserved(stem: &str) -> bool {
    let s = stem.to_ascii_uppercase();
    if matches!(s.as_str(), "CON" | "PRN" | "AUX" | "NUL") {
        return true;
    }
    let b = s.as_bytes();
    (s.starts_with("COM") || s.starts_with("LPT")) && b.len() == 4 && (b'1'..=b'9').contains(&b[3])
}

/// Make one path segment safe to write on disk. On Windows (`windows == true`)
/// illegal characters are replaced with `_`, trailing dots/spaces (which
/// Windows silently strips, causing collisions) are removed, and reserved
/// device names are neutralized; on other platforms the segment is returned
/// unchanged. Kept pure and parameterized so the Windows path is unit-tested on
/// every host — the Linux CI runner never compiles a real Windows target.
fn sanitize_segment(seg: &str, windows: bool) -> String {
    if !windows {
        return seg.to_string();
    }
    let replaced: String = seg
        .chars()
        .map(|c| {
            if WIN_ILLEGAL.contains(&c) || (c as u32) < 0x20 {
                '_'
            } else {
                c
            }
        })
        .collect();
    let trimmed = replaced.trim_end_matches([' ', '.']);
    if trimmed.is_empty() {
        return "_".to_string();
    }
    let stem = trimmed.split('.').next().unwrap_or(trimmed);
    if is_windows_reserved(stem) {
        format!("_{trimmed}")
    } else {
        trimmed.to_string()
    }
}

/// On Windows, prefix an absolute drive-letter path (`C:\…`) with the `\\?\`
/// verbatim marker so paths beyond the legacy 260-char `MAX_PATH` limit still
/// work. No-op on other platforms, for already-verbatim or UNC paths, and for
/// relative paths. Pure and parameterized by `windows` for testing; applied
/// only at the filesystem boundary so user-facing paths stay clean.
fn long_path(path: &str, windows: bool) -> Cow<'_, str> {
    if !windows || path.len() < 3 || path.starts_with(r"\\") {
        return Cow::Borrowed(path);
    }
    let b = path.as_bytes();
    let drive_abs = b[0].is_ascii_alphabetic() && b[1] == b':' && (b[2] == b'\\' || b[2] == b'/');
    if drive_abs {
        Cow::Owned(format!(r"\\?\{}", path.replace('/', r"\")))
    } else {
        Cow::Borrowed(path)
    }
}

/// The filesystem path actually passed to `std::fs` calls — extended-length on
/// Windows (see `long_path`), unchanged elsewhere.
fn fs_path(path: &Path) -> PathBuf {
    let s = path.to_string_lossy();
    PathBuf::from(long_path(&s, cfg!(windows)).into_owned())
}

/// Derive a SAFE output file name from an object key: take the last path
/// segment (splitting on both `/` and `\`), strip a single trailing `.age`,
/// reject path-traversal / empty names, and sanitize for the host filesystem.
/// A malicious key like `..\..\evil.age` can never escape the destination dir.
pub fn plaintext_file_name(key: &str) -> String {
    let last = key
        .rsplit(['/', '\\'])
        .find(|s| !s.is_empty())
        .unwrap_or(key);
    let stripped = last.strip_suffix(".age").unwrap_or(last);
    // Drop any residual separators and reject "." / ".." which would traverse.
    let cleaned = stripped.replace(['/', '\\'], "").trim().to_string();
    let base = if cleaned.is_empty() || cleaned == "." || cleaned == ".." {
        "download".to_string()
    } else {
        cleaned
    };
    sanitize_segment(&base, cfg!(windows))
}

/// Join a frontend-supplied relative path onto `dest_dir`, preserving folder
/// structure while making escape impossible. Each segment is split on `/` and
/// `\`, empty / `.` / `..` segments are dropped — so a malicious key such as
/// `../../etc/passwd` collapses to `etc/passwd` *under* `dest_dir` and can never
/// traverse outside it — and each surviving segment is sanitized for the host
/// filesystem (Windows-illegal characters, reserved names, trailing dots). If
/// nothing survives, a safe fallback name is used. The caller is responsible
/// for `.age` stripping on the final segment.
pub fn safe_dest_path(dest_dir: &Path, rel_path: &str) -> PathBuf {
    let windows = cfg!(windows);
    let mut out = dest_dir.to_path_buf();
    let mut pushed = false;
    for raw in rel_path.split(['/', '\\']) {
        let seg = raw.trim();
        if seg.is_empty() || seg == "." || seg == ".." {
            continue;
        }
        let safe = sanitize_segment(seg, windows);
        if safe.is_empty() || safe == "." || safe == ".." {
            continue;
        }
        out.push(safe);
        pushed = true;
    }
    if !pushed {
        out.push("download");
    }
    out
}

/// Disambiguate `path` against the destination paths already claimed in this
/// batch so two distinct S3 keys that map to the same on-disk name don't
/// silently overwrite each other — e.g. `Report` vs `report` on a
/// case-insensitive APFS/NTFS volume, or two keys that sanitize to the same
/// name. Collisions get a ` (n)` suffix before the extension. `ci` selects
/// case-insensitive comparison (macOS/Windows).
fn claim_unique(path: PathBuf, ci: bool, claimed: &mut HashSet<String>) -> PathBuf {
    let norm = |p: &Path| {
        let s = p.to_string_lossy().to_string();
        if ci {
            s.to_lowercase()
        } else {
            s
        }
    };
    if claimed.insert(norm(&path)) {
        return path;
    }
    let dir = path.parent().map(Path::to_path_buf).unwrap_or_default();
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("download")
        .to_string();
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .map(str::to_string);
    let mut n = 2u32;
    loop {
        let name = match &ext {
            Some(e) => format!("{stem} ({n}).{e}"),
            None => format!("{stem} ({n})"),
        };
        let candidate = dir.join(name);
        if claimed.insert(norm(&candidate)) {
            return candidate;
        }
        n += 1;
    }
}

/// Like `safe_dest_path`, but also de-duplicates against `claimed` so a batch
/// download never has two files silently collapse onto one path on a
/// case-insensitive filesystem. Call once per file in a batch with a shared
/// `claimed` set.
pub fn unique_dest_path(dest_dir: &Path, rel_path: &str, claimed: &mut HashSet<String>) -> PathBuf {
    let base = safe_dest_path(dest_dir, rel_path);
    let ci = cfg!(windows) || cfg!(target_os = "macos");
    claim_unique(base, ci, claimed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;
    use std::path::Path;

    #[test]
    fn strips_age_and_keeps_last_segment() {
        assert_eq!(plaintext_file_name("a/b/log.json.age"), "log.json");
        assert_eq!(plaintext_file_name("report.age"), "report");
        assert_eq!(plaintext_file_name("plain.json"), "plain.json");
    }

    #[test]
    fn resists_path_traversal() {
        // Backslash and ../ segments must never escape the destination dir.
        assert_eq!(plaintext_file_name("a/..\\..\\evil.age"), "evil");
        assert_eq!(plaintext_file_name("../../etc/passwd.age"), "passwd");
        assert_eq!(plaintext_file_name(".."), "download");
        assert_eq!(plaintext_file_name("dir/"), "dir");
        assert_eq!(plaintext_file_name(""), "download");
    }

    #[test]
    fn safe_dest_path_preserves_structure() {
        let base = Path::new("/dest");
        assert_eq!(
            safe_dest_path(base, "backups/2026-06-20/db-snapshot.sql"),
            Path::new("/dest/backups/2026-06-20/db-snapshot.sql"),
        );
        assert_eq!(
            safe_dest_path(base, "report.json"),
            Path::new("/dest/report.json"),
        );
    }

    #[test]
    fn safe_dest_path_cannot_escape() {
        let base = Path::new("/dest");
        // .. and . segments are dropped, so the result stays under /dest.
        assert_eq!(
            safe_dest_path(base, "../../etc/passwd"),
            Path::new("/dest/etc/passwd"),
        );
        assert_eq!(
            safe_dest_path(base, "a/../../b/./c"),
            Path::new("/dest/a/b/c"),
        );
        assert_eq!(safe_dest_path(base, "x\\..\\y"), Path::new("/dest/x/y"),);
        // Nothing usable → safe fallback.
        assert_eq!(safe_dest_path(base, "../.."), Path::new("/dest/download"));
        assert_eq!(safe_dest_path(base, ""), Path::new("/dest/download"));
    }

    #[test]
    fn sanitize_segment_is_a_noop_off_windows() {
        // S3 keys with `:` (ISO timestamps) etc. stay faithful on POSIX hosts.
        assert_eq!(
            sanitize_segment("2026-06-20T12:30:00Z", false),
            "2026-06-20T12:30:00Z"
        );
        assert_eq!(sanitize_segment("a*b?c", false), "a*b?c");
    }

    #[test]
    fn sanitize_segment_cleans_windows_illegal_chars() {
        // The `:` in an ISO-8601 prefix is the common real-world breaker.
        assert_eq!(
            sanitize_segment("2026-06-20T12:30:00Z", true),
            "2026-06-20T12_30_00Z"
        );
        assert_eq!(
            sanitize_segment(r#"a<b>c:d"e|f?g*h"#, true),
            "a_b_c_d_e_f_g_h"
        );
        // Control characters are replaced too.
        assert_eq!(sanitize_segment("a\u{0007}b", true), "a_b");
    }

    #[test]
    fn sanitize_segment_strips_trailing_dots_and_spaces_on_windows() {
        assert_eq!(sanitize_segment("name. ", true), "name");
        assert_eq!(sanitize_segment("data.", true), "data");
        // A segment that becomes empty falls back to a placeholder.
        assert_eq!(sanitize_segment("...", true), "_");
    }

    #[test]
    fn sanitize_segment_neutralizes_reserved_names_on_windows() {
        assert_eq!(sanitize_segment("CON", true), "_CON");
        assert_eq!(sanitize_segment("nul.json", true), "_nul.json");
        assert_eq!(sanitize_segment("COM1", true), "_COM1");
        assert_eq!(sanitize_segment("LPT9.txt", true), "_LPT9.txt");
        // COM0 / a longer name are NOT reserved.
        assert_eq!(sanitize_segment("COM0", true), "COM0");
        assert_eq!(sanitize_segment("console", true), "console");
    }

    #[test]
    fn long_path_adds_verbatim_prefix_only_on_windows_drive_paths() {
        assert_eq!(
            long_path(r"C:\Users\me\f.txt", true),
            r"\\?\C:\Users\me\f.txt"
        );
        // Forward slashes from a joined path are normalized to backslashes.
        assert_eq!(
            long_path("C:/Users/me/f.txt", true),
            r"\\?\C:\Users\me\f.txt"
        );
        // UNC, already-verbatim, relative, and non-Windows are left untouched.
        assert_eq!(long_path(r"\\server\share\f", true), r"\\server\share\f");
        assert_eq!(long_path(r"\\?\C:\already", true), r"\\?\C:\already");
        assert_eq!(long_path("relative/path", true), "relative/path");
        assert_eq!(long_path(r"C:\Users\me\f.txt", false), r"C:\Users\me\f.txt");
    }

    #[test]
    fn claim_unique_disambiguates_collisions() {
        let mut claimed = HashSet::new();
        let p = |s: &str| PathBuf::from(s);
        // First claim is kept as-is.
        assert_eq!(
            claim_unique(p("/d/Report.json"), true, &mut claimed),
            p("/d/Report.json")
        );
        // Case-insensitive collision → suffixed.
        assert_eq!(
            claim_unique(p("/d/report.json"), true, &mut claimed),
            p("/d/report (2).json"),
        );
        // A third collision bumps the counter.
        assert_eq!(
            claim_unique(p("/d/REPORT.json"), true, &mut claimed),
            p("/d/REPORT (3).json"),
        );
        // No extension → suffix appended to the whole name.
        let mut c2 = HashSet::new();
        assert_eq!(claim_unique(p("/d/data"), true, &mut c2), p("/d/data"));
        assert_eq!(claim_unique(p("/d/data"), true, &mut c2), p("/d/data (2)"));
    }

    #[test]
    fn claim_unique_case_sensitive_keeps_distinct_case() {
        // On a case-sensitive filesystem, different case = different file.
        let mut claimed = HashSet::new();
        let p = |s: &str| PathBuf::from(s);
        assert_eq!(
            claim_unique(p("/d/A.txt"), false, &mut claimed),
            p("/d/A.txt")
        );
        assert_eq!(
            claim_unique(p("/d/a.txt"), false, &mut claimed),
            p("/d/a.txt")
        );
    }
}
