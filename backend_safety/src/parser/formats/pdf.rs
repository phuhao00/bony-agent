// src/parser/formats/pdf.rs
// 使用 nom 解析 PDF 交叉引用表，提取文本流
// 注意：完整 PDF 解析极复杂，这里实现流式正则抽取（生产中可替换为 lopdf）

use anyhow::Result;
use std::borrow::Cow;

pub struct PdfPage {
    pub page: i32,
    pub text: String,
}

/// 极简 PDF 文本提取：扫描 BT...ET 块内的 Tj / TJ 操作符
/// 对标准 PDF 效果良好；加密/扫描版 PDF 返回空串（由调用方触发 OCR fallback）
pub fn extract_text(data: &[u8]) -> Result<Vec<PdfPage>> {
    let content = String::from_utf8_lossy(data);

    // 计算总页数（简单计数 /Type /Page 非 /Pages 的出现次数）
    let page_count = content.matches("/Type /Page\n").count()
        + content.matches("/Type /Page ").count()
        + content.matches("/Type/Page\n").count()
        + content.matches("/Type/Page ").count();
    let page_count = if page_count == 0 { 1 } else { page_count };

    // 提取所有 BT...ET 块
    let mut pages: Vec<PdfPage> = Vec::new();
    let mut current_page = 1i32;
    let mut page_text = String::new();
    let mut stream_count = 0usize;

    // 遍历 stream...endstream
    let mut rest: &str = &content;
    while let Some(start) = rest.find("stream") {
        rest = &rest[start + 6..];
        let end = rest.find("endstream").unwrap_or(rest.len());
        let block = &rest[..end];

        // 在 stream 块中找 BT...ET
        let mut inner = block;
        while let Some(bt) = inner.find("BT") {
            inner = &inner[bt + 2..];
            let et = inner.find("ET").unwrap_or(inner.len());
            let bt_block = &inner[..et];

            // 提取 (text) Tj 和 [(text)] TJ
            page_text.push_str(&extract_tj(bt_block));
            inner = &inner[et..];
        }

        stream_count += 1;
        // 粗略分页：每 N 个 stream 作为一页（启发式）
        let streams_per_page = (stream_count / page_count).max(1);
        if stream_count % streams_per_page == 0 && !page_text.trim().is_empty() {
            pages.push(PdfPage {
                page: current_page,
                text: std::mem::take(&mut page_text),
            });
            current_page += 1;
        }

        rest = &rest[end..];
    }

    // 剩余文本
    if !page_text.trim().is_empty() {
        pages.push(PdfPage {
            page: current_page,
            text: page_text,
        });
    }

    Ok(pages)
}

/// 从 BT 块中提取 Tj / TJ 字符串
fn extract_tj(block: &str) -> String {
    let mut out = String::new();
    let mut rest = block;

    while let Some(lp) = rest.find('(') {
        rest = &rest[lp + 1..];
        let rp = find_closing_paren(rest);
        let text = &rest[..rp];
        out.push_str(&decode_pdf_string(text));
        out.push(' ');
        rest = &rest[rp..];
    }
    out
}

/// 找到未转义的 ')' 位置
fn find_closing_paren(s: &str) -> usize {
    let mut depth = 0usize;
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'\\' => {
                i += 2;
                continue;
            }
            b'(' => depth += 1,
            b')' => {
                if depth == 0 {
                    return i;
                }
                depth -= 1;
            }
            _ => {}
        }
        i += 1;
    }
    s.len()
}

/// 解码 PDF 字面字符串（处理转义序列）
fn decode_pdf_string(s: &str) -> Cow<'_, str> {
    if !s.contains('\\') {
        return Cow::Borrowed(s);
    }
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some('n') => out.push('\n'),
                Some('r') => out.push('\r'),
                Some('t') => out.push('\t'),
                Some('(') => out.push('('),
                Some(')') => out.push(')'),
                Some('\\') => out.push('\\'),
                Some(other) => {
                    out.push('\\');
                    out.push(other);
                }
                None => {}
            }
        } else {
            out.push(c);
        }
    }
    Cow::Owned(out)
}
