import re

NAME_MAX = 64
DESC_MAX = 1024
NAME_PATTERN = re.compile(r"^[a-z0-9-]+$")
XML_TAG_RE = re.compile(r"</?[a-zA-Z][^>]*>")
RESERVED_WORDS = ["anthropic", "claude"]


def validate_skill_name(name: str) -> list[str]:
    errors: list[str] = []
    name = name.strip()
    if not name:
        errors.append("Name is required")
        return errors
    if len(name) > NAME_MAX:
        errors.append(f"Name must be {NAME_MAX} characters or fewer")
    if not NAME_PATTERN.match(name):
        errors.append("Name must contain only lowercase letters, numbers, and hyphens")
    for word in RESERVED_WORDS:
        if word in name:
            errors.append(f'Name cannot contain reserved word "{word}"')
    if XML_TAG_RE.search(name):
        errors.append("Name cannot contain XML tags")
    return errors


def validate_skill_description(description: str) -> list[str]:
    errors: list[str] = []
    description = description.strip()
    if not description:
        errors.append("Description is required")
        return errors
    if len(description) > DESC_MAX:
        errors.append(f"Description must be {DESC_MAX} characters or fewer")
    if XML_TAG_RE.search(description):
        errors.append("Description cannot contain XML tags")
    return errors
