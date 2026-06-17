// src/parser/formats/docx.rs
// DOCX = ZIP 容器，word/document.xml 包含正文 XML

use anyhow::{Context, Result};
use quick_xml::events::Event;
use quick_xml::reader::Reader;
use std::io::Read;
use zip::ZipArchive;

pub struct DocxPage {
    pub page: i32,
    pub text: String,
}

pub fn extract_text(data: &[u8]) -> Result<Vec<DocxPage>> {
    let cursor = std::io::Cursor::new(data);
    let mut archive = ZipArchive::new(cursor).context("Failed to open DOCX as ZIP")?;

    // 读取 word/document.xml
    let xml = {
        let mut entry = archive
            .by_name("word/document.xml")
            .context("word/document.xml not found in DOCX")?;
        let mut buf = Vec::new();
        entry.read_to_end(&mut buf)?;
        String::from_utf8_lossy(&buf).into_owned()
    };

    // 解析 XML，提取 <w:t> 标签文本，<w:p> 换行
    let mut reader = Reader::from_str(&xml);
    reader.trim_text(true);

    let mut paragraphs: Vec<String> = Vec::new();
    let mut current_para = String::new();
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) | Ok(Event::Empty(ref e)) => {
                match e.name().as_ref() {
                    b"w:p" => {
                        if !current_para.is_empty() {
                            paragraphs.push(std::mem::take(&mut current_para));
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::End(ref e)) => {
                if e.name().as_ref() == b"w:p" && !current_para.is_empty() {
                    paragraphs.push(std::mem::take(&mut current_para));
                }
            }
            Ok(Event::Text(e)) => {
                current_para.push_str(&e.unescape().unwrap_or_default());
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    if !current_para.is_empty() {
        paragraphs.push(current_para);
    }

    // 按 500 段落分页
    const PARAS_PER_PAGE: usize = 500;
    let pages: Vec<DocxPage> = paragraphs
        .chunks(PARAS_PER_PAGE)
        .enumerate()
        .map(|(i, chunk)| DocxPage {
            page: (i + 1) as i32,
            text: chunk.join("\n"),
        })
        .collect();

    Ok(if pages.is_empty() {
        vec![DocxPage { page: 1, text: String::new() }]
    } else {
        pages
    })
}
