"""Performance & query-shape tests.

Catches N+1 regressions and over-fetching. Doesn't assert latency
(too flaky in CI); instead asserts on query count or row-fetch shape.
"""
from __future__ import annotations

import uuid as _uuid

import pytest
from sqlalchemy import event

from app.db.models import Skill
from app.db.models.claude_ai import (
    ClaudeAIIntegration,
    ClaudeAISkillLink,
    ClaudeAISyncOperation,
)
from app.services.claude_ai_sync import (
    bulk_integration_counters,
    integration_counters,
)


@pytest.fixture
def ten_integrations(db_session):
    """Create 10 integrations, each with 5 links + 3 ops, so the
    counters have non-trivial values to roll up."""
    rows = []
    for i in range(10):
        integ = ClaudeAIIntegration(
            status="active", scope="both", conflict_policy="ask",
            browser_label=f"perf-{i}",
        )
        db_session.add(integ)
        db_session.flush()
        for j in range(5):
            db_session.add(
                ClaudeAISkillLink(
                    integration_id=integ.id,
                    claude_ai_skill_id=f"skill_perf_{i}_{j}",
                )
            )
        for s in ("pending", "in_progress", "failed"):
            db_session.add(
                ClaudeAISyncOperation(
                    integration_id=integ.id,
                    kind="list",
                    status=s,
                )
            )
        rows.append(integ)
    db_session.commit()
    return rows


class TestBulkCountersAvoidsNPlus1:
    """The bulk-fetch helper should issue exactly 2 queries regardless
    of how many integrations are passed in.

    Before the optimization, list_integrations issued 3*N queries
    (one set per integration). With bulk_integration_counters, two
    GROUP-BY queries cover all N."""

    def test_bulk_returns_correct_counts(self, db_session, ten_integrations):
        ids = [i.id for i in ten_integrations]
        result = bulk_integration_counters(db_session, ids)
        assert len(result) == 10
        for i in ten_integrations:
            row = result[i.id]
            assert row["linked_skill_count"] == 5
            # 1 pending + 1 in_progress = 2 in the "pending" bucket
            # (in_progress is in-flight work, displayed as pending).
            assert row["pending_op_count"] == 2
            assert row["failed_op_count"] == 1

    def test_bulk_query_count(self, db_session, ten_integrations):
        """Count actual SQL queries via event hook. Must be O(1) not O(N)."""
        engine = db_session.get_bind()
        executed: list[str] = []

        def _before_cursor_execute(conn, cursor, statement, *_):
            # Only count statements that touch our tables.
            if "claude_ai_skill_links" in statement or "claude_ai_sync_operations" in statement:
                executed.append(statement)

        event.listen(engine, "before_cursor_execute", _before_cursor_execute)
        try:
            bulk_integration_counters(db_session, [i.id for i in ten_integrations])
        finally:
            event.remove(engine, "before_cursor_execute", _before_cursor_execute)

        # 2 queries: one for ops, one for links. NOT 20.
        assert len(executed) == 2, (
            f"bulk counters issued {len(executed)} queries (expected 2). "
            f"This is an N+1 regression. Queries:\n" + "\n".join(executed)
        )

    def test_single_call_helper_remains_correct(self, db_session, ten_integrations):
        """The original integration_counters helper still works for
        single-row callers (kept as a backwards-compatible alias)."""
        result = integration_counters(db_session, ten_integrations[0].id)
        assert result["linked_skill_count"] == 5
        assert result["pending_op_count"] == 2
        assert result["failed_op_count"] == 1

    def test_bulk_empty_input_returns_empty(self, db_session):
        assert bulk_integration_counters(db_session, []) == {}

    def test_bulk_missing_integration_gets_zeros(self, db_session, ten_integrations):
        """Pass an ID that has no ops + no links. Should return zero counts,
        not crash."""
        result = bulk_integration_counters(db_session, [_uuid.uuid4()])
        assert len(result) == 1
        for k, v in next(iter(result.values())).items():
            assert v == 0, f"expected zero {k}, got {v}"
