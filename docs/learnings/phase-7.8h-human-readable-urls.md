# Learnings: 7.8-H Human-readable URLs

- **CloudFront distribution-level error responses apply to ALL origins — including API Gateway.** Using `CustomErrorResponses` (404/403 → 200+index.html) for SPA routing breaks API error codes once the API is routed through CloudFront. **Action:** Replace distribution-level error responses with a `VIEWER_REQUEST` CloudFront Function on the default (S3) behavior that rewrites extensionless paths to `/index.html`. This scopes SPA routing to S3 and lets API 4xx responses pass through unchanged — Done.

- **GitHub passes unset optional secrets as empty string `""`, not null.** CDK C# props populated from `secrets.DOMAIN_NAME` evaluate as `""` when the secret is absent; `!= null` guards never trigger, causing CDK to attempt certificate/alias creation with an empty string and fail. **Action:** Replace every `!= null` guard on optional config props with `string.IsNullOrEmpty()` — Done. Added a note to CLAUDE.md guardrails — Done.

- **CloudFront `AllowedMethods` defaults to GET+HEAD only.** Custom behaviors added to CloudFront silently drop POST, PUT, PATCH, DELETE unless `AllowedMethods = AllowedMethods.ALLOW_ALL` is set explicitly. The frontend appeared to work for reads but all writes returned 200+index.html, which was invisible until testing mutations. **Action:** Always set `AllowedMethods.ALLOW_ALL` on API-origin behaviors and add an infra-assertion test that verifies it — TODO.

- **CDK bootstrap must be run in every account/region pair.** The pipeline failed when deploying a cross-region `CertificateStack` to `us-east-1` in the Test account because only `ap-southeast-2` had been bootstrapped. **Action:** Document in the phase doc that bootstrap must run per-region (already captured in 7.8-A manual steps) — Documented.

- **`ClickNewNoteAsync` shared its 30 s Playwright timeout between the API call and UI rendering**, making `EnterTitleAsync` occasionally time out on a Lambda scale-out cold start. **Action:** Await a `WaitForResponseAsync` for `POST /notes` inside `ClickNewNoteAsync` before returning, giving the API call its own 30 s budget — Done.

- **Seven successive CI failures from a single CDK slice.** Root cause: CDK infrastructure changes have a high blast radius — each fix required a full deploy cycle (5–10 min). Issues included bootstrap, cross-account DNS, empty-string guards, missing AllowedMethods, SPA routing conflict. **Action:** Add a CDK integration test step (cdk diff against a local synth) to the validation-backend job so structural mistakes are caught before deploy — TODO.

## Applied status

| Learning | Status |
|---|---|
| 1. CloudFront error responses scope | Applied — `NoteTakerStack.cs`: replaced `CustomErrorResponses` with `SpaRoutingFunction` on default behavior |
| 2. GitHub empty-string secrets | Applied — `NoteTakerStack.cs`: all guards use `string.IsNullOrEmpty()`; CLAUDE.md guardrails updated |
| 3. CloudFront AllowedMethods default | Documented — requires an infra-assertion test addition; TODO |
| 4. CDK bootstrap per-region | Documented — already in 7.8-A manual steps |
| 5. ClickNewNoteAsync timeout split | Applied — `AppPage.cs`: added `WaitForResponseAsync` for POST /notes |
| 6. CDK change blast radius | Documented — `cdk diff` pre-check in CI would require workflow changes; TODO |
