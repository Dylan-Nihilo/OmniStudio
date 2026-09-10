"""Shared pytest configuration."""

from __future__ import annotations

import pytest

from src.billing.metering import BILLING_ENABLED_ENV


@pytest.fixture(autouse=True)
def _billing_disabled_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep the suite hermetic against the developer's shell.

    With billing on, every generation route needs a published price book and a funded
    wallet, so a stray OMNI_STUDIO_BILLING_ENABLED=1 in the environment would turn dozens
    of unrelated tests into 503s. Billing tests opt in with monkeypatch.setenv.
    """
    monkeypatch.delenv(BILLING_ENABLED_ENV, raising=False)
