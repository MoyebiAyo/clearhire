# ClearHire Security Audit

Date: 2026-08-24

## Executive Summary

The end-to-end application checks passed for the main recruiter, candidate exam, scheduling, and RLS paths. The project has a solid RLS baseline and private CV storage, but the audit found security and integrity issues that should be addressed before treating the system as hardened for hostile traffic.

The highest-priority findings are:

1. Gmail OAuth account linking has no `state` validation.
2. Gmail `SECURITY DEFINER` token RPCs are publicly executable in the live project and accepted an anonymous mutation during testing.
3. Exam submissions and public scheduling confirmation use stale reads followed by unconditional writes, allowing concurrent races.
4. Closed exams and cancelled interviews are not rejected by all public capability routes.
5. DOCX parsing and mailbox attachment handling lack decompression and aggregate resource limits.
6. The demo reminder route invokes a globally scoped service-role runner from a tenant-scoped request.

No confirmed SQL injection, SSRF, React raw-HTML XSS sink, or cross-tenant RLS read/write was found in the tested paths.

## Test Evidence

Passed:

- `npm test`: 5 tests passed.
- `npm run build`: production build passed.
- `npx supabase migration list`: local and remote migrations `0001` through `0008` match.
- `npx tsc --noEmit`: passed when run after the build completed.
- `scripts/exam-e2e.ts`: scheduled, open, question delivery, no answer-key leak, grading, idempotent resubmission, three-strike forfeiture, expiry, and invalid-token behavior passed against a local server and linked Supabase.
- `scripts/security-e2e.ts`: temporary two-tenant RLS isolation, protected API denials, schedule flow, exact four reminder creation, ICS output, and cleanup passed.
- Anonymous RPC probe: `gmail_store_token` successfully mutated a temporary recruiter connection in the linked Supabase project. The test removed that connection and deleted the temporary users afterward.
- Live app smoke: `https://clearhire-rho.vercel.app/login` returned the expected login page.

Limitations:

- No production email was sent by the security tests.
- The demo reminder endpoint was not invoked because its global runner could affect unrelated production reminders.
- Visual authenticated browser coverage was not run with a persistent recruiter session.
- Edge/WAF configuration and deployed response headers were not fully available for source-level verification.

## Confirmed Findings

### CH-01: Public Gmail token RPCs

Severity: High

Locations:

- `supabase/migrations/0005_intake.sql:62-79`
- `src/app/api/gmail/callback/route.ts:65-71`
- `src/lib/mailbox.ts:70-76`

Evidence:

```sql
create or replace function public.gmail_store_token(
  p_recruiter uuid, p_address text, p_token text, p_key text
) returns void language plpgsql security definer
```

The functions accept an arbitrary recruiter ID, do not check `auth.uid()`, and the migrations contain no `REVOKE EXECUTE` or restricted `GRANT EXECUTE` statements. The live anonymous RPC probe successfully wrote a temporary Gmail connection.

Impact: an unauthenticated caller can overwrite another recruiter’s Gmail connection if they know the recruiter UUID. This is a cross-tenant integrity and availability issue. Token decryption was not attempted and the encryption key was not exposed.

Fix: revoke execution from `PUBLIC`, `anon`, and `authenticated`; grant only to the intended server role. Add an in-function authorization check or remove the arbitrary recruiter parameter.

### CH-02: Gmail OAuth account-linking CSRF

Severity: High

Locations:

- `src/app/api/gmail/connect/route.ts:16-30`
- `src/app/api/gmail/callback/route.ts:12-71`

The authorization request has no cryptographically random `state`, and the callback binds any returned Google code to the currently authenticated ClearHire user.

Impact: a victim can be induced to connect an attacker-controlled Gmail account to the victim’s recruiter workspace. This can replace the mailbox integration and poison intake.

Fix: require authentication before connect, create one-time state bound to the session, validate and consume it in the callback, and use a configured canonical origin.

### CH-03: Exam submission race and grading oracle

Severity: High

Locations:

- `src/app/api/exam/[token]/submit/route.ts:22-85`
- `src/lib/exam-state.ts:116-149`

Submission resolves a stale invite, grades the supplied answers, and updates by invite ID without requiring the current status to remain `in_progress`. Racing requests can each return different independently calculated scores and last-write-wins can replace the stored result.

Impact: a candidate can replay concurrent submissions to obtain an answer/score oracle or corrupt the authoritative score.

Fix: make grading and terminal transition one atomic database operation. Use a row lock or compare-and-set, accept only the first terminal submission, and return the stored result to losing requests.

### CH-04: Public scheduling race and stale capability state

Severity: High

Locations:

- `src/app/api/schedule/[token]/route.ts:86-112`
- `src/app/api/schedule/[token]/ics/route.ts:11-48`

Scheduling checks `scheduled_time` in a stale read, then unconditionally updates the interview and creates four reminders. It does not require `status = 'scheduled'`, does not expire/revoke the bearer token, and does not set `no-store` on token-authorized responses.

Impact: concurrent requests can double-book an interview and create duplicate reminder rows. Leaked tokens remain useful indefinitely. Cancelled interviews can still be scheduled.

Fix: use an atomic `UPDATE ... WHERE scheduled_time IS NULL AND status = 'scheduled' RETURNING`, create reminders transactionally with a unique `(interview_id, offset_label)` constraint, and add expiration/revocation plus `Cache-Control: private, no-store`.

### CH-05: Closed exams remain usable

Severity: Medium

Locations:

- `src/lib/exam-state.ts:36-75`
- `src/app/api/exam/[token]/start/route.ts:20-40`
- `src/app/api/exam/[token]/questions/route.ts:21-43`
- `src/app/api/exam/[token]/submit/route.ts:36-85`

The resolved parent exam status is loaded but public routes validate only invite status and timing. A valid invite can remain usable after its parent exam is closed.

Impact: recruiters cannot reliably invalidate an exam through the parent exam status.

Fix: fail closed unless `exam.status = 'active'`; expire or invalidate nonterminal invites when closing an exam.

### CH-06: DOCX decompression and upload resource exhaustion

Severity: High

Locations:

- `src/lib/mailbox.ts:134-149`
- `src/lib/intake.ts:44-53`
- `src/lib/cv/text.ts:29-31`
- `src/app/api/jobs/[id]/cvs/route.ts:45-79`

Gmail attachment size metadata is not enforced before downloading. DOCX files are ZIP containers parsed by Mammoth without expanded-size, entry-count, compression-ratio, or processing-time limits. Manual upload also has no aggregate file count/size limit.

Impact: an attacker who can deliver a matching mailbox attachment can target polling with a decompression bomb and exhaust server memory, CPU, or execution time.

Fix: enforce Gmail declared size, file count, aggregate request size, ZIP expansion limits, and isolated parsing time/memory limits.

### CH-07: Demo reminder route invokes global service-role processing

Severity: High

Locations:

- `src/app/api/demo/reminder/route.ts:27-72`
- `src/lib/reminders-runner.ts:28-169`

The demo route validates one caller-owned application, then calls `runDueReminders()`, which queries and claims all due reminders globally with the service role.

Impact: an authenticated recruiter can trigger processing and email delivery for reminders belonging to other tenants.

Fix: scope the demo runner to the caller’s recruiter, or disable the demo route outside a controlled demo environment. Only the worker-secret route should invoke the global runner.

## Additional Risks

- `applications` has a broad update policy and `cv_file_path` is mutable. Validate immutable ownership/path fields before signing CV URLs.
- Candidate identities are globally unique by email while authenticated users can insert arbitrary candidates. Decide whether global identity sharing is intentional and encode tenant-specific ownership if not.
- `processed_emails`, CV intake, interview creation, scorecard creation, exam activation, and reminder delivery are not fully transactional or idempotent.
- No application-level rate limiting exists for AI, email, mailbox, or public exam routes.
- Error responses sometimes return raw database/provider messages.
- Security headers such as CSP, `nosniff`, clickjacking protection, `Referrer-Policy`, and `Permissions-Policy` are not visible in app source. Verify the Vercel/edge response headers.
- `npm audit` reports 5 transitive vulnerabilities: 1 critical and 4 high, involving `tar`, `@mapbox/node-pre-gyp`, `postcss`, `sharp`, and the current Next.js dependency tree. Run dependency triage and upgrade to patched compatible versions.

## Recommended Order

1. Restrict Gmail RPC execution and add OAuth `state`.
2. Make exam submission and scheduling atomic.
3. Enforce parent exam/interview state and revoke expired capabilities.
4. Harden DOCX/Gmail/manual upload limits and isolate document parsing.
5. Scope or disable the demo reminder route in production.
6. Restrict application update columns and validate CV ownership paths.
7. Add rate limits, generic error responses, no-store headers, and canonical-origin configuration.
8. Triage and upgrade vulnerable dependencies.
