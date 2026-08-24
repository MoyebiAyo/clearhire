import assert from "node:assert/strict";
import test from "node:test";

import { batchEmailIds } from "./email-response";

test("batchEmailIds reads Resend's wrapped batch response", () => {
  assert.deepEqual(
    batchEmailIds({ data: [{ id: "email-1" }, { id: "email-2" }] }),
    [{ id: "email-1" }, { id: "email-2" }]
  );
});

test("batchEmailIds keeps compatibility with a bare response array", () => {
  assert.deepEqual(batchEmailIds([{ id: "email-1" }]), [{ id: "email-1" }]);
});
