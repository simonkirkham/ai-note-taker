---
slice: 1-E
title: React scaffold + CloudFront + CORS + CI wiring
date: 2026-04-30
---

# Learnings — Slice 1-E

## What I built

Vite + React + TypeScript frontend (`web/`), S3 bucket + CloudFront distribution (OAC) in CDK, CORS on the API Gateway HttpApi, and CI pipeline extensions to build and deploy the frontend.

## Surprises

**`S3Origin` was deprecated in CDK 2.188.0.** The `S3Origin` construct we originally reached for is marked obsolete. The replacement is `S3BucketOrigin.WithOriginAccessControl(bucket)` — it handles the OAI/OAC automatically, no separate `OriginAccessIdentity` needed. CDK deprecations like this don't show up until `cdk synth` / `dotnet build`; always check for compiler warnings on CDK upgrades.

**`npm ci` requires a lockfile.** CI failed immediately because `npm ci` requires `package-lock.json` and we had none (Node.js not installed locally). Fixed by switching to `npm install` in the workflow. The right fix for reproducibility is to generate and commit the lockfile, which requires installing Node.js locally. This is a maintenance gap.

**React project bootstrapped manually, not with `create-vite`.** Because npm is unavailable locally, all project files were written by hand. This works but is fragile — missing files or wrong config are only caught by CI. The handwritten config matches what `create-vite` would produce.

## Patterns established

**VITE_API_URL from CDK outputs.** The build-time env var is injected in `deploy.yml` by extracting it from `outputs.json` after `cdk deploy`. The React app never hardcodes an API URL.

**CloudFront SPA routing.** 403 and 404 from S3 both return `index.html` with HTTP 200 — React handles client-side routing without server involvement.

**`npm install && npm run build` in CI.** Without a lockfile, `npm ci` is not available. This works but is less reproducible than `npm ci` would be.

## Known gaps carried forward

- **CloudFront cache invalidation missing** — S3 sync without invalidation means deployments may not be visible for up to 24h. Add `aws cloudfront create-invalidation --distribution-id <id> --paths "/*"` to `deploy.yml`.
- **NoteView doesn't load existing title** — re-opening a named note shows a blank input. The API response from `POST /notes` doesn't include the title, and there's no `GET /notes/{id}` endpoint yet. Walking-skeleton gap; address when a note detail endpoint is added.
- **No `package-lock.json`** — install Node.js locally, run `npm install` once, and commit the lockfile so CI can use `npm ci`.
