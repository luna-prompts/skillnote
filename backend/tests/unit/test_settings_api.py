"""Unit tests for the settings API validation constants.

Imports the allowlist directly to avoid requiring fastapi in the test env.
"""
import importlib
import sys
from unittest.mock import MagicMock


def _import_valid_settings():
    """Import _VALID_SETTINGS without triggering FastAPI dependency."""
    # Create mock modules for fastapi imports
    fastapi_mock = MagicMock()
    fastapi_mock.APIRouter = MagicMock(return_value=MagicMock(get=MagicMock(), put=MagicMock()))
    fastapi_mock.Depends = MagicMock()
    fastapi_mock.HTTPException = Exception

    saved = {}
    for mod_name in ("fastapi", "app.db.session"):
        if mod_name in sys.modules:
            saved[mod_name] = sys.modules[mod_name]
        sys.modules[mod_name] = fastapi_mock

    try:
        if "app.api.settings" in sys.modules:
            del sys.modules["app.api.settings"]
        from app.api.settings import _VALID_SETTINGS
        return _VALID_SETTINGS
    finally:
        for mod_name, original in saved.items():
            sys.modules[mod_name] = original
        for mod_name in ("fastapi", "app.db.session"):
            if mod_name not in saved:
                sys.modules.pop(mod_name, None)
        sys.modules.pop("app.api.settings", None)


class TestSettingsValidation:
    def test_known_settings_all_boolean(self):
        valid = _import_valid_settings()
        for key, valid_values in valid.items():
            assert valid_values == {"true", "false"}, f"{key} should accept true/false"

    def test_expected_keys_present(self):
        valid = _import_valid_settings()
        assert "complete_skill_enabled" in valid
        assert "complete_skill_outcome_enabled" in valid

    def test_no_unexpected_keys(self):
        valid = _import_valid_settings()
        assert len(valid) == 2
