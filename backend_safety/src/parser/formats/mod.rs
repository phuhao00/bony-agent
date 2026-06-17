// src/parser/formats/mod.rs — 格式探测 + 子格式解析器
pub mod pdf;
pub mod docx;
pub mod text;
pub mod mp4;

use std::path::Path;

/// 通过文件扩展名 + 魔数识别文档格式
#[derive(Debug, Clone, PartialEq)]
pub enum DocFormat {
    Pdf,
    Docx,
    Doc,
    Txt,
    Markdown,
    Csv,
    Json,
    Html,
    Xlsx,
    Unknown,
}

pub fn detect_format(path: &Path, header: &[u8]) -> DocFormat {
    // 优先扩展名
    match path.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase().as_str() {
        "pdf"  => return DocFormat::Pdf,
        "docx" => return DocFormat::Docx,
        "doc"  => return DocFormat::Doc,
        "txt"  => return DocFormat::Txt,
        "md" | "markdown" => return DocFormat::Markdown,
        "csv"  => return DocFormat::Csv,
        "json" => return DocFormat::Json,
        "html" | "htm" => return DocFormat::Html,
        "xlsx" | "xls" => return DocFormat::Xlsx,
        _ => {}
    }
    // 魔数兜底
    match header {
        h if h.starts_with(b"%PDF") => DocFormat::Pdf,
        h if h.starts_with(b"PK\x03\x04") => DocFormat::Docx, // DOCX/XLSX/ZIP
        _ => DocFormat::Unknown,
    }
}
