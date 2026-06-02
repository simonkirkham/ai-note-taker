# Learnings — Slice 12-F: Frontend monitoring (CloudWatch RUM)

## A `CfnAppMonitor` does not authorize the browser — you must build the Cognito pool + guest role yourself

The CloudWatch RUM console wizard, when you create an AppMonitor, quietly also creates a **Cognito identity pool** and an **unauthenticated (guest) IAM role** granting `rum:PutRumEvents`. That's how the anonymous browser web client gets temporary AWS credentials to send events. **`CfnAppMonitor` (CloudFormation/CDK) does none of that.** Create only the AppMonitor and the browser client authenticates as nobody, every `PutRumEvents` call fails, and the monitor sits silently empty — with no synth error and no deploy error to tell you.

The minimal correct wiring for an anonymous static SPA:

1. `CfnIdentityPool` with `AllowUnauthenticatedIdentities = true`.
2. An IAM `Role` assumed by `cognito-identity.amazonaws.com` (the `aud` = pool id, `amr` = `unauthenticated` trust conditions, `sts:AssumeRoleWithWebIdentity`), with an inline policy allowing exactly `rum:PutRumEvents` on the monitor ARN.
3. `CfnIdentityPoolRoleAttachment` mapping `unauthenticated` → that role.
4. Pass `IdentityPoolId` + `GuestRoleArn` into `AppMonitorConfiguration`.
5. The browser snippet needs the **identity pool id** too — so emit it as a second `CfnOutput` (`RumIdentityPoolId`) alongside `RumMonitorId`.

**Rule:** any time you replace a console "it just works" resource with CFN/CDK, list what the console silently created on your behalf. For RUM that's a whole Cognito auth path.

## Breaking the role↔monitor dependency cycle: build the ARN from the fixed name

The guest role's policy must reference the monitor ARN; the monitor's config must reference the role ARN. Referencing `rumMonitor.AttrArn` from the role creates a CloudFormation circular dependency. Break it by constructing the ARN from the **fixed monitor name** with `Arn.Format(new ArnComponents { Service = "rum", Resource = "appmonitor", ResourceName = "notetaker-rum" }, this)` — no dependency on the L1 attribute. The name is therefore used in two places (the `Arn.Format` and `CfnAppMonitor.Name`) and they **must** match, so it lives in one `const`.

## `AttrId`, not `.Ref` — and the failure is silent

The browser snippet's `applicationId` is the AppMonitor's generated **GUID**, which is `rumMonitor.AttrId`. `rumMonitor.Ref` returns the monitor **name** (`notetaker-rum`) for this resource type. Inject the name where a GUID is expected and RUM drops the events with no client-visible error. There is no type to stop you — only knowing which attribute is which.

## RUM and Cognito ship inside `Amazon.CDK.Lib` — no extra NuGet package

The monolithic CDK v2 package (`Amazon.CDK.Lib`) contains `Amazon.CDK.AWS.RUM` and `Amazon.CDK.AWS.Cognito`. No `<PackageReference>` is needed — just a `using` (or fully-qualify). Guidance written against the old modular layout (one package per service) will tell you to "add `Amazon.CDK.AWS.RUM`"; on v2 that's a no-op that sends you looking for a package that doesn't exist separately.

## Keep the AppMonitor ID out of source; inject into the built artifact, fail-closed

`web/index.html` carries only an empty `<script id="rum-snippet"></script>` placeholder — the ID is environment-specific and never committed. `deploy.yml` reads the stack outputs and injects the populated `cwr` snippet into **`dist/index.html`** (the build artifact), never the source, after `npm run build` and before the S3 sync. Two guards make it fail-closed rather than ship blind: reject empty/`"null"` outputs (GitHub passes unset secrets as `""`; `jq` on a missing key returns `"null"`), and `exit 1` if the placeholder string isn't found in `dist/index.html`. Localhost / PR-preview builds never run the workflow, so their placeholder stays empty and no RUM client loads off the monitored domain — which matters because RUM only accepts events from the configured domain anyway.

A `node -e '…'` step does the literal string replace instead of `sed`: the snippet is full of `/`, `{`, and `"` that are painful to escape in a `sed` expression, and the script is single-quoted with only backtick template literals inside, so there's no shell/YAML quoting hazard.

## CDK template assertions prove the wiring exists, not that data flows

`Template.FromStack` confirms the AppMonitor, identity pool, guest-role policy, and outputs are in the synthesized template — necessary, but (same caveat as 12-D) it cannot prove the browser actually authenticates and events arrive. The real verification is post-deploy: throw an error on the live site, confirm it appears in the `notetaker-rum` console within ~1 min, and that `PutRumEvents` → `dataplane.rum.{region}` returns 200 (proves the Cognito guest-role path works).

## The cwr.js loader CDN is global (us-east-1 only) — only the data plane is regional

The first deploy shipped a snippet whose loader URL was `https://client.rum.{region}.amazonaws.com/3.x/cwr.js` with `{region} = eu-west-2`. That host **does not exist** — `client.rum.eu-west-2.amazonaws.com` returns NXDOMAIN. The RUM web-client loader CDN is served **only from `us-east-1`**, globally, regardless of which region the AppMonitor and data plane live in. So the `<script>` failed to load, `window.cwr(...)` calls queued forever, nothing was ever sent, and the RUM console showed "we haven't received any data" with a flat-zero `RumEventCount` — even though the AppMonitor, Cognito pool, guest role, ARN, domain, and snippet injection were all correct.

The split that's easy to get wrong:
- **Loader script:** `https://client.rum.us-east-1.amazonaws.com/{version}/cwr.js` — **always `us-east-1`**. (`1.x`/`2.x`/`3.x` all resolve there.)
- **Data plane `endpoint`:** `https://dataplane.rum.{region}.amazonaws.com` — **regional** (your deployment region).

**Rule:** in the RUM snippet, hard-code `us-east-1` for the loader host and keep only the `endpoint` regional. This is invisible to every pre-deploy gate: the host is a literal string in a CI heredoc, not exercised by `Template.FromStack` assertions, the build, or a unit test — it only fails at runtime DNS in a real browser. The catch was a manual post-deploy check + reading `RumEventCount`. Treat "throw an error, confirm it lands, confirm `PutRumEvents` 200" as a mandatory post-deploy step for any RUM change, not optional. (Fixed in hotfix `hotfix/12-f-rum-cdn-host` → BUG-6.)
