from pathlib import Path

from app.core.config import settings


class LocalBundleStorage:
    def __init__(self, base_dir: str | None = None):
        self.base_dir = Path(base_dir or settings.bundle_storage_dir)

    def resolve(self, storage_key: str) -> Path:
        path = (self.base_dir / storage_key).resolve()
        base = self.base_dir.resolve()
        if base not in path.parents and path != base:
            raise ValueError("Invalid storage key path")
        return path

    def exists(self, storage_key: str) -> bool:
        return self.resolve(storage_key).exists()


storage = LocalBundleStorage()
