#!/usr/bin/env python3
"""Import deanpeters/Product-Manager-Skills starter pack into .agent/skills/."""

from __future__ import annotations

import re
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEMP = ROOT / "storage" / "temp" / "pm-import"
SKILLS_DIR = ROOT / ".agent" / "skills"
ELECTRON = ROOT / "electron" / "resources" / "agent-skills"
URL = "https://github.com/deanpeters/Product-Manager-Skills/releases/latest/download/pm-skills-starter-pack.zip"

SKILL_IDS = [
    "discovery-process",
    "jobs-to-be-done",
    "prioritization-advisor",
    "product-strategy-session",
    "roadmap-planning",
    "user-story",
]

FM_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)


def parse_fm(text: str) -> dict[str, str]:
    m = FM_RE.match(text)
    if not m:
        return {}
    meta: dict[str, str] = {}
    for line in m.group(1).splitlines():
        if ":" in line:
            k, _, v = line.partition(":")
            meta[k.strip()] = v.strip()
    return meta


def build_fm(meta: dict[str, str]) -> str:
    return (
        "---\n"
        f"name: {meta.get('name', '')}\n"
        f"description: {meta.get('description', '')}\n"
        "category: product-manager\n"
        "source: deanpeters-pm-skills\n"
        "version: 1.0.0\n"
        "---\n\n"
    )


def copy_skill_assets(src_dir: Path, dest: Path) -> None:
    """Copy assets except Skill.md (macOS case-insensitive FS: Skill.md == SKILL.md)."""
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)
    for item in src_dir.iterdir():
        if item.name.lower() == "skill.md":
            continue
        target = dest / item.name
        if item.is_dir():
            shutil.copytree(item, target)
        else:
            shutil.copy2(item, target)


def download_and_extract() -> Path:
    TEMP.mkdir(parents=True, exist_ok=True)
    pack = TEMP / "pm-skills-starter-pack.zip"
    if not pack.exists():
        subprocess.run(["curl", "-fsSL", "-o", str(pack), URL], check=True)
    extracted = TEMP / "extracted"
    if extracted.exists():
        shutil.rmtree(extracted)
    extracted.mkdir(parents=True)
    with zipfile.ZipFile(pack) as zf:
        zf.extractall(extracted)
    for sid in SKILL_IDS:
        inner = extracted / f"{sid}.zip"
        with zipfile.ZipFile(inner) as zf:
            zf.extractall(extracted)
    return extracted


def import_skill(extracted: Path, sid: str) -> None:
    src_dir = extracted / sid
    skill_md = src_dir / "Skill.md"
    if not skill_md.exists():
        raise FileNotFoundError(f"Skill.md missing for {sid}")

    content = skill_md.read_text(encoding="utf-8")
    meta = parse_fm(content)
    body = FM_RE.sub("", content, count=1).lstrip()
    out = build_fm(meta) + body

    dest = SKILLS_DIR / sid
    copy_skill_assets(src_dir, dest)
    (dest / "SKILL.md").write_text(out, encoding="utf-8")

    edest = ELECTRON / sid
    copy_skill_assets(dest, edest)
    (edest / "SKILL.md").write_text(out, encoding="utf-8")
    print(f"imported {sid}")


def main() -> int:
    extracted = download_and_extract()
    for sid in SKILL_IDS:
        import_skill(extracted, sid)
    print(f"Done: {len(SKILL_IDS)} PM skills")
    return 0


if __name__ == "__main__":
    sys.exit(main())
