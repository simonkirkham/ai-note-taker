# Phase 25-A — Note image media store (presigned S3)

Backend foundation for inline note images: a private S3 bucket + `presign-upload` / `resolve` endpoints. Three non-obvious findings worth keeping.

## 1. A 4th direct `Function.AddToRolePolicy` silently drops a *conditional* post-`CurrentVersion` grant

**Symptom:** adding an S3 permission via `apiFunction.AddToRolePolicy(...)` made the **existing** SSM `ssm:GetParameter` statement vanish from the synthesised IAM policy — the `Lambda_HasSsmGetParameterPermission` assertion went red even though that code was untouched.

| Fact | Detail |
|---|---|
| Trigger | Adding **any** extra distinct `apiFunction.AddToRolePolicy(...)` statement, regardless of whether it was placed before or after `CurrentVersion` |
| What broke | The conditional SSM grant (added after `apiAlias` reads `apiFunction.CurrentVersion`) stopped rendering |
| What did **not** break it | The DynamoDB grants — they use the **resource-grant path** (`table.GrantReadWriteData(fn)` → `role.addToPrincipalPolicy`), not `Function.AddToRolePolicy` |
| Fix | Grant via the resource: `imagesBucket.GrantReadWrite(apiFunction, "notes/*")`. SSM grant restored. |

**Rule:** to add Lambda permissions on a resource, prefer `resource.GrantX(fn, ...)` over `apiFunction.AddToRolePolicy(...)`. The direct-`AddToRolePolicy` path interacts badly with `CurrentVersion`/alias hashing and can drop other statements.

**Corollary (env vars):** a new bucket/table env var must ride the **constructor `Environment` dictionary** (so create the bucket *before* the Lambda), not a post-construction `apiFunction.AddEnvironment(...)` — the latter runs after `CurrentVersion` is hashed and is excluded. Same pattern the table names already follow.

## 2. `Match.ArrayWith` matches in *subsequence order*

A CDK assertion `Match.ArrayWith(["s3:GetObject*", "s3:PutObject", "s3:DeleteObject*"])` failed even though all three actions were present — because the rendered statement orders them `GetObject* … DeleteObject* … PutObject`, and `ArrayWith` requires the pattern elements to appear **in the given order**. Fix: assert each action with its own single-element `ArrayWith` so the test doesn't couple to CDK's action ordering.

## 3. Presigned PUT cannot enforce object size

The 10 MB cap is validated against the client-**declared** `contentLength` at presign time, but a presigned PUT does not bind the uploaded object's size — a hostile client could PUT more. The content-**type** allowlist *is* enforced (the signed `Content-Type` must be echoed). Hard size enforcement needs a presigned **POST policy** (`content-length-range`), which the .NET S3 SDK has no first-class generator for, or an S3 object-size check. Accepted as an advisory guard under the single-owner threat model; documented in code and flagged as a follow-up. See `NoteImageHandlers.PresignUpload`.

## Process note

This slice merged against heavy concurrent churn on `main` (Phase 23 landed 23-A and 23-B mid-flight, rewriting the note layer + workspace scoping). Cost: three `origin/main` merges and a recurring flaky-E2E (`TagsJourney.RemoveTag_PillDisappears`) that red-failed several deploys and needed re-runs. The image endpoints were moved into 23-B's `MapWorkspaceScopedRoutes` so they are workspace-scoped like every other note-content route.
