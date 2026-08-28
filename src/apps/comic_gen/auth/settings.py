"""Centralized W3 authentication settings and local signing-secret persistence."""

from __future__ import annotations

import json
import os
import secrets
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

from sqlalchemy import text
from sqlalchemy.engine import Engine


@dataclass(frozen=True)
class AuthSettings:
    signing_secret: str
    setup_token: str | None = None
    password_reset_token: str | None = None
    access_ttl_seconds: int = 900
    refresh_ttl_seconds: int = 1209600
    cookie_secure: bool = False
    allowed_origins: tuple[str, ...] = (
        "http://localhost:3008",
        "http://127.0.0.1:3008",
    )
    issuer: str = "lumenx"
    audience: str = "lumenx-studio"
    trusted_proxy_cidrs: tuple[str, ...] = ()
    app_env: str = "production"
    allow_test_bypass: bool = False

    def __post_init__(self) -> None:
        # Keep the invariant at construction time as well as in from_env(): a
        # test identity bypass can never be enabled by accidentally constructing
        # production settings directly in application code.
        normalized_env = self.app_env.strip().lower() or "production"
        object.__setattr__(self, "app_env", normalized_env)
        if self.allow_test_bypass and normalized_env != "test":
            raise RuntimeError("test auth bypass is allowed only when APP_ENV=test")

    @classmethod
    def from_env(
        cls,
        *,
        engine: Engine | None = None,
        config_path: str | Path | None = None,
        environ: Mapping[str, str] | None = None,
    ) -> "AuthSettings":
        env = os.environ if environ is None else environ
        app_env = str(env.get("APP_ENV", "production")).strip().lower() or "production"
        allow_test_bypass = _bool_env(env, "LUMENX_AUTH_TEST_BYPASS", False)
        if allow_test_bypass and app_env != "test":
            raise RuntimeError("LUMENX_AUTH_TEST_BYPASS is allowed only when APP_ENV=test")
        path = Path(config_path or env.get("LUMENX_CONFIG_PATH", "~/.lumen-x/config.json")).expanduser()
        stored = _read_config(path)
        secret = env.get("LUMENX_AUTH_SIGNING_SECRET") or _stored_secret(stored)
        if not secret:
            if engine is not None and _count_users(engine) > 0:
                raise RuntimeError(
                    "LUMENX_AUTH_SIGNING_SECRET is missing while the database already has users"
                )
            secret = secrets.token_urlsafe(32)
            _write_secret(path, stored, secret)
        if len(secret.encode("utf-8")) < 32:
            raise ValueError("LUMENX_AUTH_SIGNING_SECRET must contain at least 32 bytes")

        setup_token = env.get("LUMENX_SETUP_TOKEN") or None
        if (
            setup_token is not None
            and len(setup_token.encode("utf-8")) < 32
        ):
            raise ValueError("LUMENX_SETUP_TOKEN must contain at least 32 bytes")

        password_reset_token = env.get("LUMENX_PASSWORD_RESET_TOKEN") or None
        if (
            password_reset_token is not None
            and len(password_reset_token.encode("utf-8")) < 32
        ):
            raise ValueError("LUMENX_PASSWORD_RESET_TOKEN must contain at least 32 bytes")

        access_ttl = _int_env(env, "LUMENX_AUTH_ACCESS_TTL_SECONDS", 900)
        refresh_ttl = _int_env(env, "LUMENX_AUTH_REFRESH_TTL_SECONDS", 1209600)
        if not 900 <= access_ttl <= 1800:
            raise ValueError("LUMENX_AUTH_ACCESS_TTL_SECONDS must be between 900 and 1800")
        if not 7 * 86400 <= refresh_ttl <= 30 * 86400:
            raise ValueError(
                "LUMENX_AUTH_REFRESH_TTL_SECONDS must be between 604800 and 2592000"
            )
        env_origins = env.get("LUMENX_AUTH_ALLOWED_ORIGINS", "").strip()
        if env_origins:
            origins = _csv(env_origins)
        else:
            # Local development defaults; production deployments must set
            # LUMENX_AUTH_ALLOWED_ORIGINS explicitly.
            origins = ("http://localhost:3008", "http://127.0.0.1:3008")
        if "*" in origins:
            raise ValueError("LUMENX_AUTH_ALLOWED_ORIGINS must not contain '*'")
        return cls(
            signing_secret=secret,
            setup_token=setup_token,
            password_reset_token=password_reset_token,
            access_ttl_seconds=access_ttl,
            refresh_ttl_seconds=refresh_ttl,
            cookie_secure=_bool_env(env, "LUMENX_AUTH_COOKIE_SECURE", False),
            allowed_origins=origins,
            issuer=env.get("LUMENX_AUTH_ISSUER", "lumenx"),
            audience=env.get("LUMENX_AUTH_AUDIENCE", "lumenx-studio"),
            trusted_proxy_cidrs=_csv(env.get("LUMENX_AUTH_TRUSTED_PROXY_CIDRS", "")),
            app_env=app_env,
            allow_test_bypass=allow_test_bypass,
        )

    load = from_env


def _read_config(path: Path) -> dict:
    if not path.is_file():
        return {}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"Could not read LumenX config: {path}") from exc
    if not isinstance(value, dict):
        raise RuntimeError(f"LumenX config must be a JSON object: {path}")
    return value


def _stored_secret(config: dict) -> str | None:
    auth = config.get("auth")
    if isinstance(auth, dict) and isinstance(auth.get("signing_secret"), str):
        return auth["signing_secret"]
    if isinstance(config.get("auth_signing_secret"), str):
        return config["auth_signing_secret"]
    return None


def _write_secret(path: Path, config: dict, secret: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    updated = dict(config)
    auth = dict(updated.get("auth") or {})
    auth["signing_secret"] = secret
    updated["auth"] = auth
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(updated, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    try:
        os.chmod(temp, 0o600)
    except OSError:
        pass
    temp.replace(path)
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


def _count_users(engine: Engine) -> int:
    from sqlalchemy import inspect

    if "users" not in inspect(engine).get_table_names():
        return 0
    with engine.connect() as connection:
        return int(connection.scalar(text("SELECT COUNT(*) FROM users")) or 0)


def _csv(value: str) -> tuple[str, ...]:
    return tuple(item.strip() for item in value.split(",") if item.strip())


def _int_env(env: Mapping[str, str], key: str, default: int) -> int:
    try:
        return int(env.get(key, default))
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{key} must be an integer") from exc


def _bool_env(env: Mapping[str, str], key: str, default: bool) -> bool:
    value = env.get(key)
    if value is None:
        return default
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise ValueError(f"{key} must be a boolean")


__all__ = ["AuthSettings"]
