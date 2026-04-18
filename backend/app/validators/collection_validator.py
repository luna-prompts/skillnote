import re

from app.validators.skill_validator import RESERVED_WORDS

COLLECTION_NAME_MAX = 128
NAME_PATTERN = re.compile(r"^[a-z0-9_-]+$")
XML_TAG_RE = re.compile(r"</?[a-zA-Z][^>]*>")


def validate_collection_name(name: str) -> list[str]:
    errors: list[str] = []
    if name is None:
        errors.append("Collection name is required")
        return errors
    stripped = name.strip()
    if not stripped:
        errors.append("Collection name is required")
        return errors
    if len(stripped) > COLLECTION_NAME_MAX:
        errors.append(f"Collection name must be {COLLECTION_NAME_MAX} characters or fewer")
    if "\n" in stripped or "\r" in stripped:
        errors.append("Collection name cannot contain newlines")
    if not NAME_PATTERN.match(stripped):
        errors.append("Collection name must contain only lowercase letters, numbers, hyphens, and underscores")
    for word in RESERVED_WORDS:
        if word in stripped:
            errors.append(f'Collection name cannot contain reserved word "{word}"')
    if XML_TAG_RE.search(stripped):
        errors.append("Collection name cannot contain XML tags")
    return errors
