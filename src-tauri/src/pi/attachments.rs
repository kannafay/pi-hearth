use super::types::{Attachment, AttachmentPreview};
use base64::{Engine, engine::general_purpose::STANDARD};
use image::{
    DynamicImage, ImageEncoder, ImageReader,
    codecs::{
        jpeg::JpegEncoder,
        png::{CompressionType, FilterType, PngEncoder},
    },
};
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet},
    io::{Cursor, Read},
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::State;
use uuid::Uuid;

const MAX_FILE: usize = 20 * 1024 * 1024;
const MAX_TEXT: usize = 128 * 1024;
const MAX_IMAGE_TOTAL: usize = 4 * 1024 * 1024;
pub const MAX_ATTACHMENTS: usize = 10;

pub struct PreparedAttachment {
    pub view: Attachment,
    name: String,
    content: String,
    image: Option<Value>,
}

#[derive(Default)]
pub struct AttachmentManager(Mutex<HashMap<String, PreparedAttachment>>);

fn escaped(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn data_url(bytes: &[u8], mime: &str) -> String {
    format!("data:{mime};base64,{}", STANDARD.encode(bytes))
}

fn media_type(name: &str) -> Option<(&'static str, &'static str)> {
    match name.rsplit('.').next()?.to_ascii_lowercase().as_str() {
        "png" => Some(("image", "image/png")),
        "jpg" | "jpeg" => Some(("image", "image/jpeg")),
        "gif" => Some(("image", "image/gif")),
        "webp" => Some(("image", "image/webp")),
        "mp4" | "m4v" => Some(("video", "video/mp4")),
        "webm" => Some(("video", "video/webm")),
        "mov" => Some(("video", "video/quicktime")),
        "ogv" => Some(("video", "video/ogg")),
        "mp3" => Some(("audio", "audio/mpeg")),
        "m4a" => Some(("audio", "audio/mp4")),
        "wav" => Some(("audio", "audio/wav")),
        "ogg" | "oga" => Some(("audio", "audio/ogg")),
        "flac" => Some(("audio", "audio/flac")),
        _ => None,
    }
}

fn encode_png(image: &DynamicImage) -> Result<Vec<u8>, String> {
    let rgba = image.to_rgba8();
    let mut bytes = Vec::new();
    PngEncoder::new_with_quality(&mut bytes, CompressionType::Fast, FilterType::Sub)
        .write_image(
            &rgba,
            rgba.width(),
            rgba.height(),
            image::ExtendedColorType::Rgba8,
        )
        .map_err(|_| "无法处理图片。")?;
    Ok(bytes)
}

fn decode_image(bytes: &[u8]) -> Result<DynamicImage, String> {
    let mut reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| "无法识别图片格式。")?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(16384);
    limits.max_image_height = Some(16384);
    limits.max_alloc = Some(256 * 1024 * 1024);
    reader.limits(limits);
    reader
        .decode()
        .map_err(|_| "图片无法读取或尺寸过大。".into())
}

fn image_attachment(name: &str, bytes: &[u8]) -> Result<PreparedAttachment, String> {
    let image = decode_image(bytes)?;
    prepare_image(name, &image, bytes.len())
}

fn prepare_image(
    name: &str,
    image: &DynamicImage,
    source_size: usize,
) -> Result<PreparedAttachment, String> {
    let preview = data_url(&encode_png(&image.thumbnail(160, 160))?, "image/png");
    let mut processed = Vec::new();
    // Bound the RPC record, including images echoed into native session events.
    let resized = image.thumbnail(1600, 1600).to_rgba8();
    let mut background = image::RgbaImage::from_pixel(
        resized.width(),
        resized.height(),
        image::Rgba([255, 255, 255, 255]),
    );
    image::imageops::overlay(&mut background, &resized, 0, 0);
    let rgb = DynamicImage::ImageRgba8(background).to_rgb8();
    JpegEncoder::new_with_quality(&mut processed, 90)
        .encode_image(&rgb)
        .map_err(|_| "无法压缩图片。")?;
    if processed.len() > MAX_IMAGE_TOTAL {
        return Err("图片过大，请缩小后重试。".into());
    }
    Ok(PreparedAttachment {
        view: Attachment {
            id: Uuid::new_v4().to_string(),
            name: Path::new(name)
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into(),
            kind: "image".into(),
            mime_type: "image/jpeg".into(),
            size: source_size as u32,
            preview: Some(preview),
            source_path: None,
            text: None,
        },
        name: name.into(),
        content: String::new(),
        image: Some(
            json!({"type":"image","mimeType":"image/jpeg","data":STANDARD.encode(processed)}),
        ),
    })
}

#[cfg(any(windows, test))]
fn cached_image(name: &str, bytes: &[u8], root: &Path) -> Result<PreparedAttachment, String> {
    let mut file = prepare(name, bytes)?;
    cache_file(&mut file, bytes, root)?;
    Ok(file)
}

fn clipboard_image(
    image: arboard::ImageData<'_>,
    root: &Path,
) -> Result<PreparedAttachment, String> {
    if image.bytes.len() > 256 * 1024 * 1024 || image.width > 16384 || image.height > 16384 {
        return Err("剪贴板图片尺寸过大。".into());
    }
    if image.width == 0 || image.height == 0 {
        return Err("无法读取剪贴板图片。".into());
    }
    let image = image::RgbaImage::from_raw(
        image.width as u32,
        image.height as u32,
        image.bytes.into_owned(),
    )
    .ok_or("无法读取剪贴板图片。")?;
    let image = DynamicImage::ImageRgba8(image);
    let bytes = encode_png(&image)?;
    if bytes.len() > MAX_FILE {
        return Err("单个附件不能超过 20 MiB。".into());
    }
    // Keep the original pixels for previews without decoding our own PNG again.
    let mut file = prepare_image("粘贴的图片.png", &image, bytes.len())?;
    cache_file(&mut file, &bytes, root)?;
    Ok(file)
}

fn prepare(name: &str, bytes: &[u8]) -> Result<PreparedAttachment, String> {
    if bytes.len() > MAX_FILE {
        return Err("单个附件不能超过 20 MiB。".into());
    }
    if image::guess_format(bytes).is_ok() {
        return image_attachment(name, bytes);
    }
    let text = std::str::from_utf8(bytes)
        .ok()
        .filter(|text| !text.contains('\0'));
    let inline = text.filter(|_| bytes.len() <= MAX_TEXT);
    let media = media_type(name).filter(|(kind, _)| *kind != "image");
    Ok(PreparedAttachment {
        view: Attachment {
            id: Uuid::new_v4().to_string(),
            name: Path::new(name)
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into(),
            kind: media
                .map_or(
                    if inline.is_some() { "text" } else { "file" },
                    |(kind, _)| kind,
                )
                .into(),
            mime_type: media
                .map_or(
                    if text.is_some() {
                        "text/plain"
                    } else {
                        "application/octet-stream"
                    },
                    |(_, mime)| mime,
                )
                .into(),
            size: bytes.len() as u32,
            preview: None,
            source_path: None,
            text: inline.map(|text| text.trim_start_matches('\u{feff}').to_owned()),
        },
        name: name.into(),
        content: inline
            .map(|text| text.trim_start_matches('\u{feff}').to_owned())
            .unwrap_or_else(|| "本地文件附件，请按需使用工具读取或解析。".into()),
        image: None,
    })
}

fn read_file(path: &str) -> Result<(PathBuf, Vec<u8>), String> {
    let path = dunce::canonicalize(path).map_err(|_| format!("附件不存在：{path}"))?;
    let metadata = std::fs::metadata(&path).map_err(|_| "无法读取附件。")?;
    if !metadata.is_file() {
        return Err("请选择文件，文件夹请添加为项目。".into());
    }
    if metadata.len() > MAX_FILE as u64 {
        return Err("单个附件不能超过 20 MiB。".into());
    }
    let mut bytes = Vec::new();
    std::fs::File::open(&path)
        .map_err(|_| "无法打开附件。")?
        .take((MAX_FILE + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| "无法读取附件。")?;
    if bytes.len() > MAX_FILE {
        return Err("单个附件不能超过 20 MiB。".into());
    }
    Ok((path, bytes))
}

fn prepare_path(path: &str, root: &Path) -> Result<PreparedAttachment, String> {
    let (path, bytes) = read_file(path)?;
    let mut file = prepare(&path.to_string_lossy(), &bytes)?;
    cache_file(&mut file, &bytes, root)?;
    Ok(file)
}

fn cache_file(file: &mut PreparedAttachment, bytes: &[u8], root: &Path) -> Result<(), String> {
    std::fs::create_dir_all(root).map_err(|_| "无法保存附件，请检查文件保存位置。")?;
    let root = dunce::canonicalize(root).map_err(|_| "无法访问文件保存位置。")?;
    let directory = root.join(&file.view.id);
    std::fs::create_dir(&directory).map_err(|_| "无法创建附件目录。")?;
    let target = directory.join(
        Path::new(&file.view.name)
            .file_name()
            .unwrap_or_else(|| std::ffi::OsStr::new("attachment")),
    );
    if std::fs::write(&target, bytes).is_err() {
        let _ = std::fs::remove_file(&target);
        let _ = std::fs::remove_dir(&directory);
        return Err("无法保存附件，请检查文件保存位置。".into());
    }
    file.name = target.to_string_lossy().into();
    file.view.source_path = Some(file.name.clone());
    Ok(())
}

fn preview_path(path: &str) -> Result<AttachmentPreview, String> {
    let (path, bytes) = read_file(path)?;
    let media = image::guess_format(&bytes)
        .ok()
        .map(|format| ("image", format.to_mime_type()))
        .or_else(|| media_type(&path.to_string_lossy()));
    if let Some((kind, mime)) = media {
        return Ok(AttachmentPreview {
            kind: kind.into(),
            source: Some(data_url(&bytes, mime)),
            text: None,
        });
    }
    if bytes.len() <= MAX_TEXT
        && let Ok(text) = std::str::from_utf8(&bytes)
        && !text.contains('\0')
    {
        return Ok(AttachmentPreview {
            kind: "text".into(),
            source: None,
            text: Some(text.trim_start_matches('\u{feff}').into()),
        });
    }
    Err("暂不支持此格式的内置预览。".into())
}

#[tauri::command]
pub async fn attachment_preview(path: String) -> Result<AttachmentPreview, String> {
    tauri::async_runtime::spawn_blocking(move || preview_path(&path))
        .await
        .map_err(|_| "无法读取附件。")?
}

impl AttachmentManager {
    fn insert(&self, files: Vec<PreparedAttachment>) -> Result<Vec<Attachment>, String> {
        let mut stored = self.0.lock().map_err(|_| "附件暂不可用。")?;
        if stored.len() + files.len() > 50 {
            return Err("待发送附件过多，请移除部分附件。".into());
        }
        let views = files.iter().map(|file| file.view.clone()).collect();
        for file in files {
            stored.insert(file.view.id.clone(), file);
        }
        Ok(views)
    }

    pub fn prompt(&self, message: &str, ids: &[String]) -> Result<Value, String> {
        if ids.len() > MAX_ATTACHMENTS {
            return Err("每条消息最多添加 10 个附件。".into());
        }
        let stored = self.0.lock().map_err(|_| "附件暂不可用。")?;
        let mut seen = HashSet::new();
        let mut text = String::new();
        let mut images = vec![];
        let mut views = vec![];
        for id in ids {
            if !seen.insert(id) {
                continue;
            }
            let file = stored.get(id).ok_or("附件已失效，请重新添加。")?;
            text.push_str(&format!(
                "<file name=\"{}\">\n{}\n</file>\n",
                escaped(&file.name),
                file.content
            ));
            if let Some(image) = &file.image {
                images.push(image.clone());
            }
            views.push(file.view.clone());
        }
        let display = if message.trim().is_empty() {
            "请查看附件。"
        } else {
            message
        };
        text.push_str(display);
        if text.len() > 256 * 1024 {
            return Err("消息与文本附件内容合计不能超过 256 KiB。".into());
        }
        if images
            .iter()
            .filter_map(|image| image["data"].as_str())
            .map(str::len)
            .sum::<usize>()
            > MAX_IMAGE_TOTAL * 4 / 3
        {
            return Err("图片总量过大，请减少图片数量或分开发送。".into());
        }
        Ok(
            json!({"type":"prompt","message":text,"images":images,"__hearthMessage":display,"__hearthAttachments":views}),
        )
    }

    pub fn release(&self, ids: &[String]) {
        if let Ok(mut stored) = self.0.lock() {
            for id in ids {
                stored.remove(id);
            }
        }
    }
}

#[tauri::command]
pub async fn attachment_paths(
    app: tauri::AppHandle,
    manager: State<'_, AttachmentManager>,
    paths: Vec<String>,
) -> Result<Vec<Attachment>, String> {
    if paths.len() > MAX_ATTACHMENTS {
        return Err("每次最多添加 10 个附件。".into());
    }
    let root = super::files::uploads(&app).await?;
    let files = tauri::async_runtime::spawn_blocking(move || {
        paths
            .iter()
            .map(|path| prepare_path(path, &root))
            .collect::<Result<Vec<_>, _>>()
    })
    .await
    .map_err(|_| "无法读取附件。")??;
    manager.insert(files)
}

#[tauri::command]
pub async fn attachment_bytes(
    app: tauri::AppHandle,
    manager: State<'_, AttachmentManager>,
    name: String,
    data: String,
) -> Result<Vec<Attachment>, String> {
    if data.len() > MAX_FILE * 4 / 3 + 4 {
        return Err("单个附件不能超过 20 MiB。".into());
    }
    let root = super::files::uploads(&app).await?;
    let file = tauri::async_runtime::spawn_blocking(move || {
        let bytes = STANDARD.decode(data).map_err(|_| "附件数据无效。")?;
        let mut file = prepare(&name, &bytes)?;
        // Keep a stable local source for tools and previews after sending.
        cache_file(&mut file, &bytes, &root)?;
        Ok::<_, String>(file)
    })
    .await
    .map_err(|_| "无法处理附件。")??;
    manager.insert(vec![file])
}

#[tauri::command]
pub async fn attachment_clipboard_available() -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(|| -> Result<bool, String> {
        #[cfg(windows)]
        {
            use clipboard_win::formats;
            let png_available = clipboard_win::register_format("PNG")
                .is_some_and(|format| clipboard_win::is_format_avail(format.into()));
            Ok(png_available
                || [
                    formats::CF_HDROP,
                    formats::CF_BITMAP,
                    formats::CF_DIB,
                    formats::CF_DIBV5,
                ]
                .into_iter()
                .any(clipboard_win::is_format_avail))
        }
        #[cfg(not(windows))]
        {
            let mut clipboard = arboard::Clipboard::new().map_err(|_| "无法访问剪贴板。")?;
            match clipboard.get_image() {
                Ok(_) => Ok(true),
                Err(arboard::Error::ContentNotAvailable) => Ok(false),
                Err(_) => Err("无法读取剪贴板。".into()),
            }
        }
    })
    .await
    .map_err(|_| "无法读取剪贴板。")?
}

#[tauri::command]
pub async fn attachment_clipboard(
    app: tauri::AppHandle,
    manager: State<'_, AttachmentManager>,
) -> Result<Vec<Attachment>, String> {
    let root = super::files::uploads(&app).await?;
    let files = tauri::async_runtime::spawn_blocking(move || {
        #[cfg(windows)]
        if clipboard_win::is_format_avail(clipboard_win::formats::CF_HDROP) {
            let paths: Vec<String> = clipboard_win::get_clipboard(clipboard_win::formats::FileList)
                .map_err(|_| "剪贴板正忙，请再次粘贴。")?;
            if paths.len() > MAX_ATTACHMENTS {
                return Err("每次最多添加 10 个附件。".into());
            }
            return paths.iter().map(|path| prepare_path(path, &root)).collect();
        }
        #[cfg(windows)]
        if let Some(format) = clipboard_win::register_format("PNG")
            && clipboard_win::is_format_avail(format.into())
        {
            // Browsers and screenshot tools already offer PNG; reuse those bytes.
            let bytes: Vec<u8> =
                clipboard_win::get_clipboard(clipboard_win::formats::RawData(format.into()))
                    .map_err(|_| "剪贴板正忙，请再次粘贴。")?;
            return Ok(vec![cached_image("粘贴的图片.png", &bytes, &root)?]);
        }
        let mut clipboard = arboard::Clipboard::new().map_err(|_| "无法访问剪贴板。")?;
        match clipboard.get_image() {
            Ok(image) => Ok(vec![clipboard_image(image, &root)?]),
            Err(arboard::Error::ContentNotAvailable) => Ok(vec![]),
            Err(_) => Err("无法读取剪贴板图片，请再次粘贴。".into()),
        }
    })
    .await
    .map_err(|_| "无法读取剪贴板。")??;
    manager.insert(files)
}

#[tauri::command]
pub fn attachment_release(manager: State<'_, AttachmentManager>, ids: Vec<String>) {
    manager.release(&ids);
}

// Pi CLI stores @file input as leading <file> blocks plus native image content.
pub fn restored_user(raw: &Value) -> (String, Option<Vec<Attachment>>) {
    let mut text = raw["content"]
        .as_str()
        .map(str::to_owned)
        .unwrap_or_else(|| {
            raw["content"]
                .as_array()
                .map(|blocks| {
                    blocks
                        .iter()
                        .filter_map(|block| {
                            (block["type"] == "text")
                                .then(|| block["text"].as_str())
                                .flatten()
                        })
                        .collect::<Vec<_>>()
                        .join("\n")
                })
                .unwrap_or_default()
        });
    let mut attachments = vec![];
    while text.starts_with("<file name=\"") {
        let Some(name_end) = text[12..].find("\">").map(|index| index + 12) else {
            break;
        };
        let Some(end) = text[name_end + 2..]
            .find("</file>")
            .map(|index| index + name_end + 2 + 7)
        else {
            break;
        };
        let name = text[12..name_end]
            .replace("&quot;", "\"")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&amp;", "&");
        let content = text[name_end + 2..end - 7].trim_matches(['\r', '\n']);
        let inline = (!content.is_empty()
            && content != "本地文件附件，请按需使用工具读取或解析。"
            && content.len() <= MAX_TEXT)
            .then(|| content.to_owned());
        let media = media_type(&name);
        let id = Path::new(&name)
            .parent()
            .and_then(Path::file_name)
            .and_then(|name| name.to_str())
            .and_then(|id| Uuid::parse_str(id).ok())
            .unwrap_or_else(Uuid::new_v4)
            .to_string();
        attachments.push(Attachment {
            id,
            name: name.rsplit(['/', '\\']).next().unwrap_or(&name).into(),
            kind: media
                .map_or(
                    if inline.is_some() { "text" } else { "file" },
                    |(kind, _)| kind,
                )
                .into(),
            mime_type: media.map_or("", |(_, mime)| mime).into(),
            size: 0,
            preview: None,
            source_path: Path::new(&name).is_absolute().then_some(name),
            text: inline,
        });
        text = text[end..].trim_start_matches(['\r', '\n']).into();
    }
    if let Some(blocks) = raw["content"].as_array() {
        let mut file_index = 0;
        for block in blocks.iter().filter(|block| block["type"] == "image") {
            let preview = block["data"]
                .as_str()
                .filter(|data| data.len() < 12 * 1024 * 1024)
                .and_then(|data| STANDARD.decode(data).ok())
                .and_then(|bytes| decode_image(&bytes).ok())
                .and_then(|image| encode_png(&image.thumbnail(240, 240)).ok())
                .map(|bytes| data_url(&bytes, "image/png"));
            let index = (file_index..attachments.len()).find(|index| {
                let name = attachments[*index].name.to_lowercase();
                [".png", ".jpg", ".jpeg", ".webp", ".gif"]
                    .iter()
                    .any(|extension| name.ends_with(extension))
            });
            if let Some(index) = index {
                file_index = index + 1;
                attachments[index].kind = "image".into();
                attachments[index].preview = preview;
            } else {
                attachments.push(Attachment {
                    id: Uuid::new_v4().to_string(),
                    name: format!(
                        "图片 {}",
                        attachments
                            .iter()
                            .filter(|item| item.kind == "image")
                            .count()
                            + 1
                    ),
                    kind: "image".into(),
                    mime_type: block["mimeType"].as_str().unwrap_or_default().into(),
                    size: 0,
                    preview,
                    source_path: None,
                    text: None,
                });
            }
        }
    }
    (text, (!attachments.is_empty()).then_some(attachments))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uploads_keep_durable_copies_unique_names_and_stable_ids_after_history_reload() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../work/upload-storage-test")
            .join(Uuid::new_v4().to_string());
        let project = root.join("project");
        let uploads = root.join("Files/Uploads");
        std::fs::create_dir_all(&project).unwrap();
        let source = project.join("参考资料.txt");
        std::fs::write(&source, "原始内容").unwrap();
        let first = prepare_path(source.to_str().unwrap(), &uploads).unwrap();
        let second = prepare_path(source.to_str().unwrap(), &uploads).unwrap();
        assert_ne!(first.view.id, second.view.id);
        assert_eq!(first.view.name, "参考资料.txt");
        let copied = first.view.source_path.clone().unwrap();
        assert!(Path::new(&copied).starts_with(dunce::canonicalize(&uploads).unwrap()));
        assert_eq!(std::fs::read_to_string(&source).unwrap(), "原始内容");
        let manager = AttachmentManager::default();
        let files = manager.insert(vec![first, second]).unwrap();
        std::fs::write(&source, "后来修改").unwrap();
        std::fs::remove_file(&source).unwrap();
        let ids = files.iter().map(|file| file.id.clone()).collect::<Vec<_>>();
        let body = manager.prompt("分析附件", &ids).unwrap();
        manager.release(&ids);
        let (_, restored) = restored_user(&json!({"content": body["message"]}));
        let restored = restored.unwrap();
        assert_eq!(restored[0].id, ids[0]);
        assert_eq!(restored[1].id, ids[1]);
        assert_eq!(restored[0].source_path.as_deref(), Some(copied.as_str()));
        assert_eq!(std::fs::read_to_string(&copied).unwrap(), "原始内容");
        assert_eq!(
            preview_path(&copied).unwrap().text.as_deref(),
            Some("原始内容")
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[ignore = "manual clipboard import benchmark"]
    fn attachment_import_timing() {
        let image = DynamicImage::ImageRgba8(image::RgbaImage::from_fn(2560, 1440, |x, y| {
            image::Rgba([(x % 256) as u8, (y % 256) as u8, ((x + y) % 256) as u8, 255])
        }));
        let bytes = encode_png(&image).unwrap();
        let root =
            std::env::temp_dir().join(format!("pi-hearth-attachment-bench-{}", Uuid::new_v4()));
        let start = std::time::Instant::now();
        cached_image("benchmark.png", &bytes, &root).unwrap();
        let png_time = start.elapsed();
        let rgba = image.to_rgba8().into_raw();
        let start = std::time::Instant::now();
        clipboard_image(
            arboard::ImageData {
                width: 2560,
                height: 1440,
                bytes: rgba.into(),
            },
            &root,
        )
        .unwrap();
        println!(
            "PNG_IMPORT_MS={} BITMAP_IMPORT_MS={}",
            png_time.as_millis(),
            start.elapsed().as_millis()
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn clipboard_png_and_bitmap_keep_original_pixels_and_bounded_prompt_images() {
        let root = std::env::temp_dir().join(format!("pi-hearth-clipboard-{}", Uuid::new_v4()));
        let original = image::RgbaImage::from_fn(200, 100, |x, _| {
            image::Rgba([17, 64, 128, if x < 100 { 0 } else { 128 }])
        });
        let png = encode_png(&DynamicImage::ImageRgba8(original.clone())).unwrap();
        let files = [
            cached_image("original.png", &png, &root).unwrap(),
            clipboard_image(
                arboard::ImageData {
                    width: 200,
                    height: 100,
                    bytes: original.clone().into_raw().into(),
                },
                &root,
            )
            .unwrap(),
        ];
        for file in files {
            assert_eq!(file.view.kind, "image");
            let source = std::fs::read(file.view.source_path.unwrap()).unwrap();
            assert_eq!(decode_image(&source).unwrap().to_rgba8(), original);
            assert_eq!(source.len(), file.view.size as usize);
            if file.view.name == "original.png" {
                assert_eq!(source, png);
            }
            let preview = file.view.preview.unwrap();
            let preview = STANDARD.decode(preview.split_once(',').unwrap().1).unwrap();
            let preview = decode_image(&preview).unwrap();
            assert_eq!((preview.width(), preview.height()), (160, 80));
            let payload = file.image.unwrap();
            let jpeg = STANDARD.decode(payload["data"].as_str().unwrap()).unwrap();
            let prompt_image = decode_image(&jpeg).unwrap().to_rgb8();
            assert!(prompt_image.get_pixel(0, 0)[0] > 240);
        }
        assert!(
            clipboard_image(
                arboard::ImageData {
                    width: 16385,
                    height: 1,
                    bytes: Vec::new().into()
                },
                &root
            )
            .is_err()
        );
        assert!(
            clipboard_image(
                arboard::ImageData {
                    width: 0,
                    height: 0,
                    bytes: Vec::new().into()
                },
                &root
            )
            .is_err()
        );
        assert!(
            clipboard_image(
                arboard::ImageData {
                    width: 2,
                    height: 2,
                    bytes: vec![0; 4].into()
                },
                &root
            )
            .is_err()
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn text_and_image_attachments_reach_native_prompt_and_restore_as_cards() {
        let manager = AttachmentManager::default();
        let image = DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
            8,
            8,
            image::Rgba([0, 0, 0, 0]),
        ));
        let image_bytes = encode_png(&image).unwrap();
        let views = manager
            .insert(vec![
                prepare("D:/notes.txt", b"ATTACHMENT-CONTEXT-731").unwrap(),
                prepare("D:/picture.png", &image_bytes).unwrap(),
            ])
            .unwrap();
        let ids = views.iter().map(|view| view.id.clone()).collect::<Vec<_>>();
        let body = manager.prompt("总结附件", &ids).unwrap();
        assert!(
            body["message"]
                .as_str()
                .unwrap()
                .contains("ATTACHMENT-CONTEXT-731")
        );
        assert_eq!(body["images"].as_array().unwrap().len(), 1);
        let jpeg = STANDARD
            .decode(body["images"][0]["data"].as_str().unwrap())
            .unwrap();
        let rgb = decode_image(&jpeg).unwrap().to_rgb8();
        assert!(
            rgb.get_pixel(0, 0)[0] > 240,
            "transparent pixels must use a white background"
        );
        let (text, restored) = restored_user(
            &json!({"content":[{"type":"text","text":body["message"]},body["images"][0].clone()]}),
        );
        assert_eq!(text, "总结附件");
        let restored = restored.unwrap();
        assert_eq!(restored.len(), 2);
        assert_eq!(restored[0].name, "notes.txt");
        assert_eq!(restored[1].name, "picture.png");
        assert!(
            restored[1]
                .preview
                .as_ref()
                .unwrap()
                .starts_with("data:image/png;base64,")
        );
        manager.release(&ids);
        assert!(manager.prompt("retry", &ids).is_err());
    }

    #[test]
    fn native_cli_image_and_plain_text_history_remain_readable() {
        let (text, attachments) = restored_user(&json!({"content":"ordinary message"}));
        assert_eq!(text, "ordinary message");
        assert!(attachments.is_none());
        let (text, attachments) = restored_user(
            &json!({"content":[{"type":"text","text":"look"},{"type":"image","mimeType":"image/png","data":"invalid"}]}),
        );
        assert_eq!(text, "look");
        assert_eq!(attachments.unwrap()[0].kind, "image");
        let file = prepare("D:/report.pdf", b"%PDF\0binary").unwrap();
        assert_eq!(file.view.kind, "file");
        assert!(file.content.contains("本地文件"));
    }

    #[test]
    fn previews_keep_original_images_and_restore_video_sources_after_sending() {
        let root = std::env::temp_dir().join(format!("pi-hearth-preview-{}", Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let image_path = root.join("picture.png");
        let image = DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
            320,
            240,
            image::Rgba([0, 128, 255, 255]),
        ));
        std::fs::write(&image_path, encode_png(&image).unwrap()).unwrap();
        let original = preview_path(image_path.to_str().unwrap()).unwrap();
        let encoded = original.source.unwrap();
        let bytes = STANDARD.decode(encoded.split_once(',').unwrap().1).unwrap();
        let decoded = decode_image(&bytes).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (320, 240));

        let video_path = root.join("clip.mp4");
        let video = b"\0\0\0\x18ftypmp42\0\0\0\0mp42isom";
        std::fs::write(&video_path, video).unwrap();
        let manager = AttachmentManager::default();
        let files = manager
            .insert(vec![
                prepare_path(video_path.to_str().unwrap(), &root.join("Uploads")).unwrap(),
            ])
            .unwrap();
        assert_eq!(files[0].kind, "video");
        let ids = vec![files[0].id.clone()];
        let body = manager.prompt("查看视频", &ids).unwrap();
        let (_, restored) = restored_user(&json!({ "content": body["message"] }));
        manager.release(&ids);
        let restored = restored.unwrap();
        assert_eq!(restored[0].kind, "video");
        let preview = preview_path(restored[0].source_path.as_deref().unwrap()).unwrap();
        assert_eq!(preview.kind, "video");
        assert!(
            preview
                .source
                .unwrap()
                .starts_with("data:video/mp4;base64,")
        );
        std::fs::remove_file(image_path).unwrap();
        std::fs::remove_file(video_path).unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn text_previews_restore_the_sent_content_and_unavailable_or_large_files_fail_clearly() {
        let manager = AttachmentManager::default();
        let files = manager
            .insert(vec![
                prepare(
                    "D:/notes & context.txt",
                    "原始内容\n<script>text</script>".as_bytes(),
                )
                .unwrap(),
            ])
            .unwrap();
        let body = manager.prompt("查看", &[files[0].id.clone()]).unwrap();
        let (_, restored) = restored_user(&json!({ "content": body["message"] }));
        let restored = restored.unwrap();
        assert_eq!(restored[0].kind, "text");
        assert_eq!(restored[0].text, files[0].text);

        let root =
            std::env::temp_dir().join(format!("pi-hearth-preview-limits-{}", Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        assert!(
            preview_path(root.join("missing.txt").to_str().unwrap())
                .unwrap_err()
                .contains("不存在")
        );
        let large = root.join("large.mp4");
        std::fs::File::create(&large)
            .unwrap()
            .set_len(MAX_FILE as u64 + 1)
            .unwrap();
        assert!(
            preview_path(large.to_str().unwrap())
                .unwrap_err()
                .contains("20 MiB")
        );
        let pdf = root.join("report.pdf");
        std::fs::write(&pdf, b"%PDF\0binary").unwrap();
        assert!(
            preview_path(pdf.to_str().unwrap())
                .unwrap_err()
                .contains("暂不支持")
        );
        std::fs::remove_file(large).unwrap();
        std::fs::remove_file(pdf).unwrap();
        std::fs::remove_dir(root).unwrap();
    }
}
