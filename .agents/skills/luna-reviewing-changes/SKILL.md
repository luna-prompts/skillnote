---
name: luna-reviewing-changes
description: Reviews Luna repository changes for correctness, regressions, security, and validation gaps. Use for a branch review, pull request review, or pre-commit check.
version: 1.0.0
---

# Reviewing Luna changes

## Inputs
Repository checkout, intended outcome, and comparison base (normally main; master for SkillNote).

## Procedure
1. Inspect root and applicable nested AGENTS.md guidance, the repository map, and the actual diff. Preserve unrelated work.
2. Trace changed behavior through callers, configuration, error paths, and tests. Check authorization, tenant boundaries, sensitive data, compatibility, and migration ordering where relevant.
3. For UI changes, check keyboard access, loading/empty/error states, and affected responsive layouts. For shared APIs, inspect the relevant consumer and producer.
4. Run the smallest meaningful documented checks for the changed surface. Do not run deployment, production mutations, or paid integrations as a review side effect.
5. Distinguish newly introduced failures from existing ones. Give findings only when supported by a concrete code path, reproduction, or check result.

## Output
Findings ordered by severity with file/line, impact, and suggested correction; checks run and their results; remaining coverage gaps. Explicitly say when no findings were identified. A successful config check is not proof of application behavior.

## Failure modes
If dependencies, a related repository, or credentials are unavailable, state the exact missing coverage and continue independent static review. Never invent successful tests.
