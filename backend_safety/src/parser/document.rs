// src/parser/document.rs — 文档解析入口

use anyhow::{bail, Result};
use std::path::Path;

use super::formats::{self, detect_format, DocFormat};

pub struct ParsedDocument {
    pub pages: Vec<ParsedPage>,
    pub full_text: String,
    pub format: DocFormat,
    pub page_count: i32,
}

pub struct ParsedPage {
    pub page: i32,
    pub text: String,
}

pub fn parse_document(
    data: &[u8],
    path_hint: Option<&Path>,
    start_page: i32,
    end_page: i32,
) -> Result<ParsedDocument> {
    let header = &data[..data.len().min(16)];
    let dummy = Path::new("");
    let path = path_hint.unwrap_or(dummy);
    let fmt = detect_format(path, header);

    let raw_pages: Vec<ParsedPage> = match &fmt {
        DocFormat::Pdf => {
            let pages = formats::pdf::extract_text(data)?;
            pages
                .into_iter()
                .map(|p| ParsedPage {
                    page: p.page,
                    text: p.text,
                })
                .collect()
        }
        DocFormat::Docx | DocFormat::Doc => {
            let pages = formats::docx::extract_text(data)?;
            pages
                .into_iter()
                .map(|p| ParsedPage {
                    page: p.page,
                    text: p.text,
                })
                .collect()
        }
        DocFormat::Txt
        | DocFormat::Markdown
        | DocFormat::Csv
        | DocFormat::Json
        | DocFormat::Html => {
            let pages = formats::text::parse_text(data)?;
            pages
                .into_iter()
                .map(|p| ParsedPage {
                    page: p.page,
                    text: p.text,
                })
                .collect()
        }
        DocFormat::Unknown => {
            // 尝试作为 UTF-8 文本读取
            let text = String::from_utf8_lossy(data).into_owned();
            vec![ParsedPage { page: 1, text }]
        }
        _ => bail!("Unsupported format: {:?}", fmt),
    };

    // 按页范围过滤
    let filtered: Vec<ParsedPage> = if start_page <= 1 && end_page == 0 {
        raw_pages
    } else {
        let start = (start_page as usize).saturating_sub(1);
        let end = if end_page == 0 {
            usize::MAX
        } else {
            end_page as usize
        };
        raw_pages
            .into_iter()
            .filter(|p| {
                let idx = p.page as usize;
                idx >= start + 1 && idx <= end
            })
            .collect()
    };

    let full_text = filtered
        .iter()
        .map(|p| p.text.as_str())
        .collect::<Vec<_>>()
        .join("\n\n");
    let page_count = filtered.len() as i32;

    Ok(ParsedDocument {
        pages: filtered,
        full_text,
        format: fmt,
        page_count,
    })
}
