---
name: luna-debugging-issues
description: Diagnoses reproducible Luna defects and verifies targeted fixes. Use for failing tests, runtime errors, broken UI flows, or unexpected API responses.
version: 1.0.0
---

# Debugging Luna issues

## Inputs
Observed behavior, expected behavior, affected environment, and available logs or reproduction.

## Procedure
1. Inspect repository guidance and the affected subsystem documentation. Confirm whether local configuration points at production before running the app or any integration test.
2. Build the smallest safe reproduction using local fixtures, mocks, or read-only evidence. Redact credentials and personal data from logs.
3. Form a specific hypothesis and trace inputs, state transitions, and outputs. Change one relevant variable at a time.
4. Fix the root cause with a bounded patch; preserve unrelated behavior. Add a regression check when it meaningfully protects the defect.
5. Run the reproduction and relevant nearby checks. For frontend/backend mismatches, verify the producer and consumer together.

## Output
Root cause with evidence, changed files, verification commands and outcomes, and unresolved limitations. State any operational follow-up separately; do not deploy or mutate production as an implicit part of debugging.

## Failure modes
If the bug cannot be reproduced, report what was ruled out and the missing evidence. Do not describe a speculative patch as a verified fix.
