"""Schema-level validation tests for app.schemas.claude_ai.

Validates that Pydantic enforces the same literals as the DB CHECK
constraints, so a typo at the call site fails fast as a 422 instead of
becoming a bad-state row.
"""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.schemas.claude_ai import (
    ConflictResolveRequest,
    ImportedSkillRequest,
    IntegrationPatchRequest,
    IntegrationStatusResponse,
    PairingApproveRequest,
    PairingStartRequest,
    SyncOperationCompleteRequest,
    SyncOperationOut,
)


class TestPairingStart:
    def test_label_optional(self):
        r = PairingStartRequest()
        assert r.browser_label is None

    def test_label_max_length(self):
        with pytest.raises(ValidationError):
            PairingStartRequest(browser_label="a" * 129)

    def test_label_at_max_length(self):
        # 128 is the documented cap; should be accepted.
        r = PairingStartRequest(browser_label="a" * 128)
        assert len(r.browser_label) == 128


class TestPairingApprove:
    def test_minimum_length(self):
        with pytest.raises(ValidationError):
            PairingApproveRequest(pairing_code="abc")  # below min 4

    def test_maximum_length(self):
        with pytest.raises(ValidationError):
            PairingApproveRequest(pairing_code="a" * 17)  # above max 16

    def test_valid_length(self):
        r = PairingApproveRequest(pairing_code="ABCDEF")
        assert r.pairing_code == "ABCDEF"


class TestIntegrationPatch:
    def test_scope_literal(self):
        IntegrationPatchRequest(scope="personal")
        IntegrationPatchRequest(scope="organization")
        IntegrationPatchRequest(scope="both")
        with pytest.raises(ValidationError):
            IntegrationPatchRequest(scope="bogus")

    def test_conflict_policy_literal(self):
        IntegrationPatchRequest(conflict_policy="ask")
        IntegrationPatchRequest(conflict_policy="skillnote_wins")
        IntegrationPatchRequest(conflict_policy="claude_ai_wins")
        with pytest.raises(ValidationError):
            IntegrationPatchRequest(conflict_policy="undecided")


class TestSyncOperationComplete:
    def test_success_minimal(self):
        SyncOperationCompleteRequest(success=True)

    def test_failure_with_error(self):
        SyncOperationCompleteRequest(success=False, error="something broke")

    def test_error_max_length(self):
        # Defense-in-depth cap: extensions could otherwise dump arbitrarily
        # long error blobs into the integration's last_error column.
        with pytest.raises(ValidationError):
            SyncOperationCompleteRequest(success=False, error="x" * 2001)

    def test_result_accepts_dict(self):
        r = SyncOperationCompleteRequest(
            success=True,
            result={"claude_ai_skill_id": "skill_01", "claude_ai_version": "v1"},
        )
        assert r.result["claude_ai_skill_id"] == "skill_01"


class TestConflictResolve:
    def test_three_resolutions(self):
        for res in ("keep_skillnote", "keep_claude_ai", "skip"):
            ConflictResolveRequest(resolution=res)

    def test_invalid_resolution(self):
        with pytest.raises(ValidationError):
            ConflictResolveRequest(resolution="merge")


class TestImportedSkill:
    def test_name_max_length(self):
        # Anthropic's skill name cap is 64 chars (mirrored on our side).
        # Pydantic should reject longer.
        with pytest.raises(ValidationError):
            ImportedSkillRequest(
                claude_ai_skill_id="skill_01",
                name="a" * 65,
                description="ok",
            )

    def test_description_max_length(self):
        with pytest.raises(ValidationError):
            ImportedSkillRequest(
                claude_ai_skill_id="skill_01",
                name="ok",
                description="x" * 1025,
            )

    def test_at_cap_succeeds(self):
        # 64 / 1024 should be accepted, not rejected.
        ImportedSkillRequest(
            claude_ai_skill_id="skill_01",
            name="a" * 64,
            description="x" * 1024,
        )
