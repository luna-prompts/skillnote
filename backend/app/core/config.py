from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "SkillNote Backend"
    app_env: str = "dev"
    database_url: str = "postgresql+psycopg://skillnote:skillnote@postgres:5432/skillnote"
    token_pepper: str = "change-me"
    bundle_storage_dir: str = "/app/data/bundles"

    model_config = SettingsConfigDict(env_file=".env", env_prefix="SKILLNOTE_")


settings = Settings()
