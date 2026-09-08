"""Deterministic parsing primitives for Source import previews (SRC-01/02)."""

from __future__ import annotations

import re
import unicodedata
import zipfile
from dataclasses import dataclass
from io import BytesIO

from defusedxml import ElementTree


MAX_IMPORT_BYTES = 10 * 1024 * 1024
_HEADING = re.compile(
    r"^\s*((?:第\s*[0-9零一二三四五六七八九十百千万]+\s*(?:卷|部|篇|章|节|回|集))|"
    r"(?:卷|部|篇)\s*[0-9零一二三四五六七八九十百千万]+|"
    r"(?:chapter|volume|part)\s+[0-9]+)\s*[:：.、\-— ]*(.*?)\s*$",
    re.IGNORECASE,
)
_WHITESPACE = re.compile(r"\s+")


class SourceImportError(ValueError):
    def __init__(self, code: str, message: str, *, status_code: int = 422) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


@dataclass(frozen=True)
class DecodedSource:
    content: str
    encoding: str


def decode_text(raw: bytes) -> DecodedSource:
    """Decode common Chinese novel encodings without silently replacing bytes."""
    if not raw:
        raise SourceImportError("SOURCE_IMPORT_EMPTY", "导入正文不能为空")
    candidates: list[tuple[str, str]] = []
    if raw.startswith(b"\xef\xbb\xbf"):
        candidates.append(("utf-8-sig", "utf-8"))
    elif raw.startswith((b"\xff\xfe", b"\xfe\xff")):
        candidates.append(("utf-16", "utf-16"))
    candidates.extend((("utf-8", "utf-8"), ("gb18030", "gb18030"), ("big5", "big5"), ("cp1252", "cp1252")))
    for codec, label in candidates:
        try:
            text = raw.decode(codec)
        except UnicodeDecodeError:
            continue
        if text.strip():
            return DecodedSource(_normalize_text(text), label)
    raise SourceImportError("SOURCE_IMPORT_ENCODING", "无法识别正文编码，请转换为 UTF-8 后重试")


def extract_docx(raw: bytes) -> DecodedSource:
    try:
        with zipfile.ZipFile(BytesIO(raw)) as archive:
            xml = archive.read("word/document.xml")
    except (KeyError, zipfile.BadZipFile, OSError) as exc:
        raise SourceImportError("SOURCE_IMPORT_DOCX_INVALID", "DOCX 文件无效或已损坏") from exc
    try:
        root = ElementTree.fromstring(xml)
    except ElementTree.ParseError as exc:
        raise SourceImportError("SOURCE_IMPORT_DOCX_INVALID", "DOCX 文档内容无效") from exc
    paragraphs: list[str] = []
    for paragraph in root.iter("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p"):
        parts = [node.text or "" for node in paragraph.iter("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t")]
        text = "".join(parts).strip()
        if text:
            paragraphs.append(text)
    content = _normalize_text("\n".join(paragraphs))
    if not content.strip():
        raise SourceImportError("SOURCE_IMPORT_EMPTY", "DOCX 正文不能为空")
    return DecodedSource(content, "utf-8")


def _normalize_text(value: str) -> str:
    value = unicodedata.normalize("NFC", value).replace("\r\n", "\n").replace("\r", "\n")
    return "\n".join(line.rstrip() for line in value.split("\n")).strip()


def summarize(content: str, *, limit: int = 200) -> str:
    compact = _WHITESPACE.sub(" ", content).strip()
    return compact[:limit] + ("..." if len(compact) > limit else "")


def _heading(line: str) -> tuple[str, str] | None:
    match = _HEADING.match(line)
    if not match:
        return None
    marker, rest = match.groups()
    marker = marker.strip()
    rest = rest.strip()
    if any(unit in marker for unit in ("卷", "部", "篇")):
        return ("volume", (marker + (" " + rest if rest else "")).strip())
    return ("chapter", (marker + (" " + rest if rest else "")).strip())


def identify_chapters(content: str) -> list[dict[str, object]]:
    """Return editable, 1-based line boundaries and chapter bodies."""
    lines = content.split("\n")
    headings: list[tuple[int, str, str]] = []
    volume = ""
    for index, line in enumerate(lines):
        found = _heading(line)
        if not found:
            continue
        kind, title = found
        if kind == "volume":
            volume = title
        else:
            headings.append((index, title, volume))

    if not headings:
        return [{
            "chapter_number": 1,
            "title": "全文",
            "volume": "",
            "start_line": 1,
            "end_line": len(lines),
            "content": content.strip(),
        }]

    proposals: list[dict[str, object]] = []
    for number, (heading_index, title, volume_name) in enumerate(headings, start=1):
        end_index = headings[number][0] - 1 if number < len(headings) else len(lines) - 1
        body = "\n".join(lines[heading_index + 1 : end_index + 1]).strip()
        proposals.append({
            "chapter_number": number,
            "title": title,
            "volume": volume_name,
            "start_line": heading_index + 1,
            "end_line": end_index + 1,
            "content": body or title,
        })
    return proposals


def normalize_proposals(content: str, proposals: list[dict[str, object]]) -> list[dict[str, object]]:
    """Validate/rebuild corrected boundaries against the immutable preview text."""
    if not content.strip():
        raise SourceImportError("SOURCE_IMPORT_EMPTY", "导入正文不能为空")
    lines = content.split("\n")
    if not proposals:
        raise SourceImportError("SOURCE_IMPORT_NO_CHAPTERS", "至少需要一个章节边界")
    result: list[dict[str, object]] = []
    previous_end = 0
    for number, raw in enumerate(proposals, start=1):
        try:
            start = int(raw["start_line"])
            end = int(raw["end_line"])
        except (KeyError, TypeError, ValueError) as exc:
            raise SourceImportError("SOURCE_IMPORT_BOUNDARY_INVALID", "章节边界格式无效") from exc
        if start < 1 or end < start or end > len(lines) or start <= previous_end:
            raise SourceImportError("SOURCE_IMPORT_BOUNDARY_INVALID", "章节边界必须按顺序且不能重叠")
        title = str(raw.get("title") or "").strip()
        if not title:
            title = lines[start - 1].strip() or f"第 {number} 章"
        body_start = start if _heading(lines[start - 1]) else start - 1
        body = "\n".join(lines[body_start:end]).strip()
        result.append({
            "chapter_number": number,
            "title": title,
            "volume": str(raw.get("volume") or ""),
            "start_line": start,
            "end_line": end,
            "content": body or title,
        })
        previous_end = end
    return result


__all__ = [
    "MAX_IMPORT_BYTES",
    "DecodedSource",
    "SourceImportError",
    "decode_text",
    "extract_docx",
    "identify_chapters",
    "normalize_proposals",
    "summarize",
]
