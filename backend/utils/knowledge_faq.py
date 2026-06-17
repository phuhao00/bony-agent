"""知识库 FAQ 结构化解析、持久化与索引文本生成。"""

from __future__ import annotations

import json
import logging
import math
import os
import re
import time
import uuid
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

FAQ_CONTENT_TYPE = "faq"
FAQ_FILE_SUFFIX = ".faq.json"

# 语义列：优先匹配；其余表头进入 extra
QUESTION_KEYS = (
    "question",
    "q",
    "问题",
    "提问",
    "query",
    "faq",
)
ANSWER_KEYS = (
    "answer",
    "a",
    "答案",
    "回答",
    "回复",
    "解答",
    "content",
    "内容",
    "解析",
)
TAG_KEYS = (
    "tags",
    "tag",
    "关键词",
    "关键字",
    "标签",
    "keywords",
    "keyword",
)

# 汇总/统计类 sheet 名称或列特征（跳过，避免误导入）
SUMMARY_SHEET_HINTS = ("汇总", "统计", "summary", "index", "目录")
SUMMARY_COLUMN_HINTS = ("问答数量", "数量", "count", "条数", "总计")

RESERVED_ITEM_KEYS = frozenset(
    {"id", "question", "answer", "tags", "order", "updated_at", "extra"}
)


def _now_str() -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S")


def _cell_to_str(val: Any) -> str:
    if val is None:
        return ""
    if isinstance(val, float):
        if math.isnan(val):
            return ""
        if val.is_integer():
            return str(int(val))
    text = str(val).strip()
    return "" if text.lower() == "nan" else text


def _normalize_header_name(name: Any) -> str:
    text = _cell_to_str(name)
    text = re.sub(r"[\u200b\ufeff\u00a0\t\r\n]", "", text)
    text = re.sub(r"\s+", "", text)
    return text.strip()


def _split_tags(raw: str) -> List[str]:
    return [t.strip() for t in re.split(r"[,，、|;|/]", raw) if t.strip()]


def _dedupe_tags(tags: List[str]) -> List[str]:
    seen: set[str] = set()
    out: List[str] = []
    for tag in tags:
        key = tag.strip()
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(key)
    return out


def _column_matches(col_name: str, candidates: Tuple[str, ...]) -> bool:
    name = _normalize_header_name(col_name).lower()
    if not name:
        return False
    for cand in candidates:
        c = cand.lower()
        if len(c) <= 1:
            if name == c:
                return True
            continue
        if name == c or c in name:
            return True
    return False


def _match_column(columns: List[str], candidates: Tuple[str, ...]) -> Optional[str]:
    for col in columns:
        if _column_matches(str(col), candidates):
            return str(col)
    return None


def _score_header_row(values: List[str]) -> int:
    score = 0
    for val in values:
        if not val:
            continue
        if _column_matches(val, QUESTION_KEYS):
            score += 5
        if _column_matches(val, ANSWER_KEYS):
            score += 5
        if _column_matches(val, TAG_KEYS):
            score += 2
        score += 1
    return score


def _unique_headers(headers: List[str]) -> List[str]:
    seen: Dict[str, int] = {}
    out: List[str] = []
    for raw in headers:
        base = raw or "列"
        count = seen.get(base, 0)
        seen[base] = count + 1
        out.append(base if count == 0 else f"{base}_{count + 1}")
    return out


def _coerce_extra(raw: Any) -> Dict[str, str]:
    if not isinstance(raw, dict):
        return {}
    out: Dict[str, str] = {}
    for key, val in raw.items():
        text = _cell_to_str(val)
        if text:
            out[str(key).strip()] = text
    return out


def normalize_faq_item(raw: Dict[str, Any], *, order: int = 0) -> Optional[Dict[str, Any]]:
    question = _cell_to_str(raw.get("question"))
    answer = _cell_to_str(raw.get("answer"))
    tags: List[str] = []
    extra = _coerce_extra(raw.get("extra"))

    raw_tags = raw.get("tags")
    if isinstance(raw_tags, str):
        tags.extend(_split_tags(raw_tags))
    elif isinstance(raw_tags, list):
        tags.extend(_cell_to_str(t) for t in raw_tags if _cell_to_str(t))

    for key, val in raw.items():
        if key in RESERVED_ITEM_KEYS:
            continue
        text = _cell_to_str(val)
        if not text:
            continue
        key_str = str(key).strip()
        if not question and _column_matches(key_str, QUESTION_KEYS):
            question = text
        elif not answer and _column_matches(key_str, ANSWER_KEYS):
            answer = text
        elif _column_matches(key_str, TAG_KEYS):
            tags.extend(_split_tags(text))
        else:
            extra[key_str] = text

    tags = _dedupe_tags(tags)

    if not question and not answer and not extra:
        return None

    return {
        "id": str(raw.get("id") or uuid.uuid4()),
        "question": question or "（未命名问题）",
        "answer": answer,
        "tags": tags,
        "extra": extra,
        "order": int(raw.get("order", order)),
        "updated_at": raw.get("updated_at") or _now_str(),
    }


def normalize_faq_payload(
    data: Any,
    *,
    default_title: str = "FAQ",
    allow_empty: bool = False,
) -> Optional[Dict[str, Any]]:
    if not isinstance(data, dict):
        return None
    title = str(data.get("title") or default_title).strip() or default_title
    raw_items = data.get("items") or data.get("faq") or data.get("questions") or []
    if not isinstance(raw_items, list):
        raw_items = []
    items: List[Dict[str, Any]] = []
    for idx, raw in enumerate(raw_items):
        if not isinstance(raw, dict):
            continue
        item = normalize_faq_item(raw, order=idx)
        if item:
            items.append(item)
    if not items and not allow_empty:
        return None
    items.sort(key=lambda x: x.get("order", 0))
    return {"title": title, "version": data.get("version", 1), "items": items}


def parse_faq_json_bytes(content: bytes, *, default_title: str = "FAQ") -> Optional[Dict[str, Any]]:
    try:
        data = json.loads(content.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    if isinstance(data, dict) and isinstance(data.get("items"), list) and not data["items"]:
        return normalize_faq_payload(data, default_title=default_title, allow_empty=True)
    return normalize_faq_payload(data, default_title=default_title)


def parse_faq_json_file(file_path: str) -> Optional[Dict[str, Any]]:
    try:
        with open(file_path, "rb") as f:
            content = f.read()
    except OSError:
        return None
    base = os.path.splitext(os.path.basename(file_path))[0]
    return parse_faq_json_bytes(content, default_title=base)


def _sheet_is_summary(sheet_name: str, columns: List[str]) -> bool:
    name_l = str(sheet_name or "").lower()
    if any(h in name_l for h in SUMMARY_SHEET_HINTS):
        return True
    norm_cols = [_normalize_header_name(c) for c in columns]
    has_q = _match_column(norm_cols, QUESTION_KEYS) is not None
    has_a = _match_column(norm_cols, ANSWER_KEYS) is not None
    if has_q and has_a:
        return False
    if any(_column_matches(c, SUMMARY_COLUMN_HINTS) for c in norm_cols):
        return True
    return not has_q and not has_a


def _prepare_dataframe(raw_frame: Any) -> Optional[Any]:
    try:
        import pandas as pd
    except ImportError:
        return None

    if raw_frame is None or getattr(raw_frame, "empty", True):
        return None

    best_idx = 0
    best_score = -1
    scan_limit = min(20, len(raw_frame))
    for idx in range(scan_limit):
        row_vals = [
            _normalize_header_name(v) for v in raw_frame.iloc[idx].tolist()
        ]
        if not any(row_vals):
            continue
        score = _score_header_row(row_vals)
        if score > best_score:
            best_score = score
            best_idx = idx

    if best_score < 1:
        return None

    header_cells = raw_frame.iloc[best_idx].tolist()
    headers = _unique_headers(
        [
            _normalize_header_name(v) or f"列{i + 1}"
            for i, v in enumerate(header_cells)
        ]
    )
    data = raw_frame.iloc[best_idx + 1 :].copy()
    data.columns = headers
    data = data.dropna(how="all")
    if data.empty:
        return None
    return data


def _parse_excel_row(
    row: Any,
    columns: List[Any],
    *,
    order: int,
    sheet_name: str,
) -> Optional[Dict[str, Any]]:
    question = ""
    answer = ""
    tags: List[str] = []
    extra: Dict[str, str] = {}
    assigned: set[Any] = set()

    norm_columns = [(col, _normalize_header_name(col)) for col in columns]

    for col, col_name in norm_columns:
        if not col_name:
            continue
        val = _cell_to_str(row.get(col))
        if not val:
            continue
        if not question and _column_matches(col_name, QUESTION_KEYS):
            question = val
            assigned.add(col)
        elif not answer and _column_matches(col_name, ANSWER_KEYS):
            answer = val
            assigned.add(col)

    for col, col_name in norm_columns:
        if col in assigned or not col_name:
            continue
        val = _cell_to_str(row.get(col))
        if not val:
            continue
        if _column_matches(col_name, TAG_KEYS):
            tags.extend(_split_tags(val))
            assigned.add(col)

    for col, col_name in norm_columns:
        if col in assigned or not col_name:
            continue
        val = _cell_to_str(row.get(col))
        if val:
            extra[col_name] = val

    if not question and not answer and not extra:
        return None

    # 跳过汇总行：只有数字/计数、无有效问答
    if not question and not answer:
        return None
    if question and not answer and len(question) <= 4 and question.isdigit():
        return None

    if sheet_name:
        tags.insert(0, str(sheet_name))

    return {
        "id": str(uuid.uuid4()),
        "question": question or "（未命名问题）",
        "answer": answer,
        "tags": _dedupe_tags(tags),
        "extra": extra,
        "order": order,
        "updated_at": _now_str(),
    }


def _parse_faq_excel_sheets(
    sheets: Dict[str, Any],
    *,
    default_title: str,
) -> Optional[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    order = 0
    for sheet_name, raw_frame in sheets.items():
        frame = _prepare_dataframe(raw_frame)
        if frame is None:
            continue
        columns = [_normalize_header_name(c) for c in list(frame.columns)]
        if _sheet_is_summary(str(sheet_name), columns):
            logger.info("Skip summary-like FAQ sheet: %s", sheet_name)
            continue
        for _, row in frame.iterrows():
            item = _parse_excel_row(
                row,
                list(frame.columns),
                order=order,
                sheet_name=str(sheet_name),
            )
            if item:
                items.append(item)
                order += 1
    if not items:
        return None
    return {"title": default_title, "version": 1, "items": items}


def _load_excel_sheets(content: bytes, *, filename: str) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    try:
        import io

        import pandas as pd
    except ImportError:
        return None, "服务器未安装 pandas，无法解析 Excel"

    ext = os.path.splitext(filename)[1].lower()
    if ext not in {".xlsx", ".xls", ".xlsm"}:
        ext = ".xlsx"

    engines: List[str] = []
    if ext in {".xlsx", ".xlsm"}:
        try:
            import openpyxl  # noqa: F401

            engines.append("openpyxl")
        except ImportError:
            return None, "服务器未安装 openpyxl，无法读取 .xlsx 文件，请联系管理员安装依赖"
    if ext == ".xls":
        try:
            import xlrd  # noqa: F401

            engines.append("xlrd")
        except ImportError:
            return None, "服务器未安装 xlrd，无法读取 .xls 文件"

    if not engines:
        engines = ["openpyxl", "xlrd"]

    last_error: Optional[str] = None
    for engine in engines:
        try:
            raw_sheets = pd.read_excel(
                io.BytesIO(content),
                sheet_name=None,
                header=None,
                engine=engine,
            )
            return raw_sheets, None
        except Exception as ex:
            last_error = str(ex)
            logger.warning("read_excel failed engine=%s: %s", engine, ex)

    return None, last_error or "无法读取 Excel 文件"


def parse_faq_excel_bytes(
    content: bytes,
    *,
    filename: str = "import.xlsx",
) -> Optional[Dict[str, Any]]:
    payload, _err = parse_faq_excel_bytes_detailed(content, filename=filename)
    return payload


def parse_faq_excel_bytes_detailed(
    content: bytes,
    *,
    filename: str = "import.xlsx",
) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    if not content:
        return None, "文件内容为空"

    sheets, load_err = _load_excel_sheets(content, filename=filename)
    if sheets is None:
        return None, load_err or "无法读取 Excel"

    base = os.path.splitext(os.path.basename(filename))[0]
    payload = _parse_faq_excel_sheets(sheets, default_title=base)
    if payload:
        return payload, None

    return None, (
        "未识别到有效 FAQ 行。请确认表头行包含「问题」「回答」等列，"
        "且数据行非空；汇总/统计类工作表会自动跳过"
    )


def parse_faq_excel_file(file_path: str) -> Optional[Dict[str, Any]]:
    try:
        with open(file_path, "rb") as f:
            content = f.read()
    except OSError:
        return None
    return parse_faq_excel_bytes(content, filename=os.path.basename(file_path))


def try_parse_faq_file(file_path: str) -> Optional[Dict[str, Any]]:
    if not file_path or not os.path.exists(file_path):
        return None
    lower = file_path.lower()
    if lower.endswith(FAQ_FILE_SUFFIX):
        return parse_faq_json_file(file_path)
    ext = os.path.splitext(lower)[1]
    if ext == ".json":
        return parse_faq_json_file(file_path)
    if ext in {".xlsx", ".xls", ".xlsm"}:
        return parse_faq_excel_file(file_path)
    return None


def is_faq_filepath(file_path: str) -> bool:
    return try_parse_faq_file(file_path) is not None


def faq_payload_to_index_text(payload: Dict[str, Any]) -> str:
    title = payload.get("title") or "FAQ"
    lines = [f"# {title}", ""]
    for idx, item in enumerate(payload.get("items") or [], 1):
        q = item.get("question") or ""
        a = item.get("answer") or ""
        tags = item.get("tags") or []
        extra = item.get("extra") or {}
        lines.append(f"## Q{idx}. {q}")
        if tags:
            lines.append(f"标签: {', '.join(str(t) for t in tags)}")
        if isinstance(extra, dict):
            for key, val in extra.items():
                text = _cell_to_str(val)
                if text:
                    lines.append(f"{key}: {text}")
        lines.append("")
        lines.append(a)
        lines.append("")
        lines.append("---")
        lines.append("")
    return "\n".join(lines).strip()


def write_faq_payload(file_path: str, payload: Dict[str, Any]) -> None:
    os.makedirs(os.path.dirname(file_path) or ".", exist_ok=True)
    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


def read_faq_payload(file_path: str) -> Optional[Dict[str, Any]]:
    try:
        with open(file_path, "rb") as f:
            data = json.loads(f.read().decode("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict):
        return None
    base = os.path.splitext(os.path.basename(file_path))[0]
    return normalize_faq_payload(data, default_title=base, allow_empty=True)


def make_faq_filepath(title: str, *, knowledge_dir: str) -> str:
    safe = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in title[:40]).strip("_")
    safe = safe or "faq"
    filename = f"{safe}_{time.strftime('%Y%m%d_%H%M%S')}{FAQ_FILE_SUFFIX}"
    return os.path.join(knowledge_dir, filename)
