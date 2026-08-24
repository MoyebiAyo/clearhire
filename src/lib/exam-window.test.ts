import assert from "node:assert/strict";
import test from "node:test";

import { examAttemptEndsAt, examWindowState } from "./exam-window";

test("an exam cannot start before the recruiter opening time", () => {
  assert.equal(
    examWindowState(
      "2026-08-25T09:00:00.000Z",
      "2026-08-25T17:00:00.000Z",
      Date.parse("2026-08-25T08:59:59.000Z")
    ),
    "scheduled"
  );
});

test("an exam is open only inside the recruiter window", () => {
  assert.equal(
    examWindowState(
      "2026-08-25T09:00:00.000Z",
      "2026-08-25T17:00:00.000Z",
      Date.parse("2026-08-25T12:00:00.000Z")
    ),
    "open"
  );
});

test("an exam closes after the recruiter closing time", () => {
  assert.equal(
    examWindowState(
      "2026-08-25T09:00:00.000Z",
      "2026-08-25T17:00:00.000Z",
      Date.parse("2026-08-25T17:00:00.001Z")
    ),
    "closed"
  );
});

test("an attempt ends when the exam window closes even if duration remains", () => {
  assert.equal(
    examAttemptEndsAt(
      "2026-08-25T16:50:00.000Z",
      30,
      "2026-08-25T17:00:00.000Z"
    ),
    Date.parse("2026-08-25T17:00:00.000Z")
  );
});

test("an attempt ends at its normal duration when that is earlier", () => {
  assert.equal(
    examAttemptEndsAt(
      "2026-08-25T10:00:00.000Z",
      30,
      "2026-08-25T17:00:00.000Z"
    ),
    Date.parse("2026-08-25T10:30:00.000Z")
  );
});
