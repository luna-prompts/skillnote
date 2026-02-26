from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "SkillNote Backend"
    app_env: str = "dev"
    database_url: str = "postgresql+psycopg://skillnote:skillnote@postgres:5432/skillnote"
    token_pepper: str = "change-me"
    bundle_storage_dir: str = "/app/data/bundles"
    max_bundle_size_bytes: int = 5 * 1024 * 1024
    max_zip_entries: int = 500
    max_uncompressed_bytes: int = 25 * 1024 * 1024
    enforce_https_in_prod: bool = True
    cors_origins: str = "http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000,http://127.0.0.1:3001"

    model_config = SettingsConfigDict(env_file=".env", env_prefix="SKILLNOTE_")


settings = Settings()
