#!/usr/bin/env python3
"""Backfill embeddings for skills that lack them (or re-embed all skills).

Usage::

    python scripts/backfill_embeddings.py --only-missing
    python scripts/backfill_embeddings.py --all --batch-size 50
    python scripts/backfill_embeddings.py --dry-run

Refuses to run unless ``SKILLNOTE_EMBEDDING_API_KEY`` is set. Used by the
docker-compose entrypoint after migrations to ensure existing skills get
embedded once an API key is provided.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from sqlalchemy import select, update

from app.db.models import Skill
from app.db.session import SessionLocal
from app.services import embedding_service


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Backfill skill embeddings. Embeds skill name+description "
            "(body excluded). Safe to run repeatedly; --only-missing skips "
            "already-embedded rows."
        ),
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=100,
        help="Embed this many skills per provider call (1-500, default 100)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Count + log only; do not call the provider or write to the DB",
    )
    target = parser.add_mutually_exclusive_group()
    target.add_argument(
        "--only-missing",
        dest="mode",
        action="store_const",
        const="missing",
        help="Only embed skills with NULL embedding (default)",
    )
    target.add_argument(
        "--all",
        dest="mode",
        action="store_const",
        const="all",
        help="Re-embed every skill, overwriting any existing embedding",
    )
    parser.set_defaults(mode="missing")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)

    if not (1 <= args.batch_size <= 500):
        print(
            f"ERROR: --batch-size must be in [1, 500], got {args.batch_size}",
            file=sys.stderr,
        )
        return 2

    if not embedding_service.is_configured():
        print(
            "ERROR: SKILLNOTE_EMBEDDING_API_KEY is required to backfill embeddings.",
            file=sys.stderr,
        )
        print(
            "       Set the env var (and SKILLNOTE_EMBEDDING_PROVIDER if not 'openai') "
            "and re-run.",
            file=sys.stderr,
        )
        return 1

    db = SessionLocal()
    try:
        # Build the candidate query.
        stmt = select(Skill.id, Skill.name, Skill.description).order_by(Skill.id)
        if args.mode == "missing":
            stmt = stmt.where(Skill.embedding.is_(None))

        rows = db.execute(stmt).all()
        total = len(rows)
        print(
            f"Found {total} candidate skill(s) "
            f"(mode={args.mode}, batch_size={args.batch_size}, "
            f"dry_run={args.dry_run})"
        )

        if total == 0:
            print("Nothing to do.")
            return 0

        embedded = 0
        skipped = 0
        processed = 0

        for start in range(0, total, args.batch_size):
            batch = rows[start : start + args.batch_size]
            texts = [
                embedding_service.skill_embedding_text(name, description)
                for (_id, name, description) in batch
            ]
            processed += len(batch)

            if args.dry_run:
                print(f"[{processed}/{total}] would embed {len(batch)} skill(s)")
                skipped += len(batch)
                continue

            try:
                vectors = embedding_service.embed_batch(texts)
            except embedding_service.EmbeddingError as e:
                # Provider failure on a batch — log, skip the batch, keep going.
                # We leave these skills untouched (still NULL or stale).
                print(
                    f"[{processed}/{total}] WARN: provider error on batch — skipping: {e}",
                    file=sys.stderr,
                )
                skipped += len(batch)
                continue

            # Apply the embeddings within a single transaction per batch.
            for (skill_id, _name, _description), vec in zip(batch, vectors):
                db.execute(
                    update(Skill)
                    .where(Skill.id == skill_id)
                    .values(embedding=vec)
                )
            db.commit()
            embedded += len(batch)
            print(f"[{processed}/{total}] embedded batch of {len(batch)}")

        print(f"Done. Embedded {embedded} skill(s), skipped {skipped}.")
        return 0
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
