import test from "node:test";
import assert from "node:assert/strict";

import { guessName, shouldReplaceCandidateName } from "./cv/text";
import { parseExtraction } from "./ai-schemas";

test("guessName skips CV section headings", () => {
  const cv = `SUMMARY
Senior backend engineer with 9 years of experience.

Amara Okafor
amara.okafor@example.com | London, UK`;

  assert.equal(guessName(cv), "Amara Okafor");
});

test("guessName skips contact and role lines before the candidate header", () => {
  const cv = `Senior Backend Engineer
amara.okafor@example.com | London, UK

Amara Okafor
SKILLS
Python, Go, PostgreSQL`;

  assert.equal(guessName(cv), "Amara Okafor");
});

test("guessName supports a simple two-word CV header", () => {
  assert.equal(
    guessName("David Chen\ndavid.chen@example.com\nEXPERIENCE"),
    "David Chen"
  );
});

test("parseExtraction preserves the AI-extracted candidate name", () => {
  assert.equal(
    parseExtraction({
      candidate_name: "Amara Okafor",
      experience_years: 7,
    }).candidate_name,
    "Amara Okafor"
  );
});

test("AI extraction can replace a role mistakenly stored as the name", () => {
  assert.equal(
    shouldReplaceCandidateName("Senior Backend Engineer", "Amara Okafor\nSenior Backend Engineer"),
    true
  );
});

test("AI extraction does not overwrite an existing candidate name", () => {
  assert.equal(
    shouldReplaceCandidateName("Amara Okafor", "Amara Okafor\nSenior Backend Engineer"),
    false
  );
});
