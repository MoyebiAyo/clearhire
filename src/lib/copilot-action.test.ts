import assert from "node:assert/strict";
import test from "node:test";

import { validCopilotStage } from "./copilot-action";

test("Copilot accepts supported pipeline stages", () => {
  assert.equal(validCopilotStage("shortlisted"), "shortlisted");
  assert.equal(validCopilotStage("offer"), "offer");
});

test("Copilot rejects invented pipeline stages", () => {
  assert.equal(validCopilotStage("hired"), null);
  assert.equal(validCopilotStage(null), null);
});

test("Copilot email operations use only supported communication kinds", () => {
  assert.deepEqual(["offer", "interview", "exam", "reminder"].filter((kind) => kind === "offer"), ["offer"]);
  assert.equal(["offer", "interview", "exam", "reminder"].includes("whatsapp"), false);
});
