// src/parser/formats/text.rs — 纯文本 / Markdown / CSV / JSON 解析

use anyhow::Result;

pub struct ParsedPage {
    pub page: i32,
    pub text: String,
}

/// 读取文本文件，按分页符或每 500 行切页
pub fn parse_text(data: &[u8]) -> Result<Vec<ParsedPage>> {
    let text = String::from_utf8_lossy(data);
    let lines: Vec<&str> = text.lines().collect();
    const LINES_PER_PAGE: usize = 500;

    let pages: Vec<ParsedPage> = lines
        .chunks(LINES_PER_PAGE)
        .enumerate()
        .map(|(i, chunk)| ParsedPage {
            page: (i + 1) as i32,
            text: chunk.join("\n"),
        })
        .collect();

    Ok(if pages.is_empty() {
        vec![ParsedPage { page: 1, text: text.into_owned() }]
    } else {
        pages
    })
}
