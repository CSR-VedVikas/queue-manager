"""Application settings, read from environment variables (or a local .env file)."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_SECRET = "dev-only-change-me"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    env: str = "development"  # "production" on the server
    database_url: str = "postgresql+psycopg://postgres@localhost:5432/queue_manager"
    jwt_secret: str = DEFAULT_SECRET
    jwt_expire_hours: int = 12
    cors_origins: str = "http://localhost:5173"  # comma-separated

    @property
    def sqlalchemy_url(self) -> str:
        """Neon and Render hand out 'postgres://' or 'postgresql://' URLs.
        SQLAlchemy needs the driver named explicitly, so normalise it here."""
        url = self.database_url
        for prefix in ("postgres://", "postgresql://"):
            if url.startswith(prefix):
                return "postgresql+psycopg://" + url[len(prefix):]
        return url

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip().rstrip("/") for o in self.cors_origins.split(",") if o.strip()]

    def check_production_safety(self) -> None:
        """Fail loudly at startup rather than run insecurely in production."""
        if self.env != "production":
            return
        if self.jwt_secret == DEFAULT_SECRET or len(self.jwt_secret) < 32:
            raise RuntimeError("JWT_SECRET must be set to a random value of 32+ characters in production")
        if not self.cors_origin_list or "*" in self.cors_origin_list:
            raise RuntimeError("CORS_ORIGINS must list the frontend URL(s) in production")


@lru_cache
def get_settings() -> Settings:
    return Settings()
