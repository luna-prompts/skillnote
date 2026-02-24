from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "YourSkills Backend"
    app_env: str = "dev"
    database_url: str = "postgresql+psycopg://yourskills:yourskills@postgres:5432/yourskills"
    token_pepper: str = "change-me"

    model_config = SettingsConfigDict(env_file=".env", env_prefix="YOURSKILLS_")


settings = Settings()
