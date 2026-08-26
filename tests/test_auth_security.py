from __future__ import annotations

import time

import pytest

from src.apps.comic_gen.auth.passwords import (
    hash_password,
    password_needs_rehash,
    verify_password,
)
from src.apps.comic_gen.auth.tokens import (
    decode_access_token,
    decode_refresh_token,
    hash_refresh_token,
    issue_access_token,
    issue_refresh_token,
)


@pytest.mark.parametrize("password", ["correct horse battery staple", "中文密码"])
def test_argon2_password_round_trip(password: str):
    encoded = hash_password(password)
    assert encoded.startswith("$argon2id$")
    assert verify_password(password, encoded) is True
    assert verify_password("wrong password", encoded) is False
    assert password_needs_rehash(encoded) is False


def test_missing_password_hash_still_fails_as_a_password_check():
    assert verify_password("anything", None) is False
    assert password_needs_rehash(None) is True


def test_jwt_access_and_refresh_round_trip_and_type_separation():
    secret = "s" * 32
    now = time.time()
    access = issue_access_token("user-1", "session-1", secret, now=now)
    refresh = issue_refresh_token("user-1", "session-1", secret, now=now, rotation_counter=0)
    assert decode_access_token(access, secret)["type"] == "access"
    assert decode_refresh_token(refresh, secret)["type"] == "refresh"
    with pytest.raises(Exception):
        decode_access_token(refresh, secret)
    with pytest.raises(Exception):
        decode_refresh_token(access, secret)


def test_jwt_rejects_expired_wrong_issuer_and_wrong_audience():
    secret = "s" * 32
    expired = issue_access_token("u", "s", secret, ttl_seconds=1, now=time.time() - 1000)
    with pytest.raises(Exception):
        decode_access_token(expired, secret)
    wrong_issuer = issue_access_token("u", "s", secret, issuer="other", now=time.time())
    with pytest.raises(Exception):
        decode_access_token(wrong_issuer, secret)
    wrong_audience = issue_access_token("u", "s", secret, audience="other", now=time.time())
    with pytest.raises(Exception):
        decode_access_token(wrong_audience, secret)


def test_refresh_hash_is_prefixed_sha256_and_deterministic():
    token = "eyJhbGciOiJIUzI1NiJ9.payload.signature"
    digest = hash_refresh_token(token)
    assert digest == hash_refresh_token(token)
    assert digest.startswith("sha256:")
    assert len(digest) == len("sha256:") + 64
