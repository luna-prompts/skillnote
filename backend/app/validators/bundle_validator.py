from pathlib import PurePosixPath
import re
import zipfile

import yaml

from app.core.config import settings


FRONTMATTER_RE = re.compile(r"^---\n(.*?)\n---\n", re.DOTALL)


def slugify(value: str) -> str:
    value = value.strip().lower()
    value = re.sub(r"[^a-z0-9\-\s_]", "", value)
    value = re.sub(r"[\s_]+", "-", value)
    value = re.sub(r"-+", "-", value).strip("-")
    return value


def validate_zip_and_extract_metadata(zip_path: str) -> tuple[str, str, str]:
    with zipfile.ZipFile(zip_path, "r") as zf:
        names = zf.namelist()
        if len(names) > settings.max_zip_entries:
            raise ValueError("Archive has too many entries")

        total_uncompressed = 0
        for info in zf.infolist():
            p = PurePosixPath(info.filename)
            if p.is_absolute() or ".." in p.parts:
                raise ValueError("Unsafe path in archive")
            total_uncompressed += info.file_size
            if total_uncompressed > settings.max_uncompressed_bytes:
                raise ValueError("Archive exceeds uncompressed size limit")

        skill_path = next((n for n in names if n.endswith("SKILL.md")), None)
        if not skill_path:
            raise ValueError("SKILL.md missing")

        content = zf.read(skill_path).decode("utf-8", errors="ignore")

    m = FRONTMATTER_RE.match(content)
    if not m:
        raise ValueError("YAML frontmatter missing in SKILL.md")

    frontmatter = yaml.safe_load(m.group(1)) or {}
    name = (frontmatter.get("name") or "").strip()
    description = (frontmatter.get("description") or "").strip()
    if not name or not description:
        raise ValueError("Frontmatter requires name and description")

    slug = slugify(name)
    if not slug:
        raise ValueError("Unable to derive slug from skill name")

    return name, slug, description
