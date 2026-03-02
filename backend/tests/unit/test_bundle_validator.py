import zipfile
from pathlib import Path

import pytest

from app.validators.bundle_validator import slugify, validate_zip_and_extract_metadata


def _write_zip(tmp_path: Path, files: dict[str, str]) -> Path:
    zpath = tmp_path / "skill.zip"
    with zipfile.ZipFile(zpath, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for name, content in files.items():
            zf.writestr(name, content)
    return zpath


def test_slugify_basic():
    assert slugify("API Reviewer") == "api-reviewer"
    assert slugify("  weird__Name!!  ") == "weird-name"


def test_validate_zip_happy_path(tmp_path: Path):
    zpath = _write_zip(
        tmp_path,
        {
            "SKILL.md": "---\nname: api-reviewer\ndescription: test\n---\n\n# x",
        },
    )
    name, slug, description = validate_zip_and_extract_metadata(str(zpath))
    assert name == "api-reviewer"
    assert slug == "api-reviewer"
    assert description == "test"


def test_validate_zip_missing_skill_md(tmp_path: Path):
    zpath = _write_zip(tmp_path, {"README.md": "none"})
    with pytest.raises(ValueError, match="SKILL.md missing"):
        validate_zip_and_extract_metadata(str(zpath))


def test_validate_zip_rejects_unsafe_paths(tmp_path: Path):
    zpath = _write_zip(
        tmp_path,
        {
            "../SKILL.md": "---\nname: x\ndescription: y\n---\n",
        },
    )
    with pytest.raises(ValueError, match="Unsafe path"):
        validate_zip_and_extract_metadata(str(zpath))


def test_validate_zip_rejects_too_many_entries(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    from app.validators import bundle_validator

    monkeypatch.setattr(bundle_validator.settings, "max_zip_entries", 1)
    zpath = _write_zip(
        tmp_path,
        {
            "SKILL.md": "---\nname: x\ndescription: y\n---\n",
            "extra.txt": "boom",
        },
    )
    with pytest.raises(ValueError, match="too many entries"):
        validate_zip_and_extract_metadata(str(zpath))


def test_validate_zip_rejects_large_uncompressed(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    from app.validators import bundle_validator

    monkeypatch.setattr(bundle_validator.settings, "max_uncompressed_bytes", 20)
    zpath = _write_zip(
        tmp_path,
        {
            "SKILL.md": "---\nname: x\ndescription: y\n---\n",
            "big.txt": "x" * 100,
        },
    )
    with pytest.raises(ValueError, match="uncompressed size"):
        validate_zip_and_extract_metadata(str(zpath))
