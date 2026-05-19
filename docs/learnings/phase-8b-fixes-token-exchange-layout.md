# Learnings: 8-B fixes — backend token exchange and layout hotfix

- Google OAuth2 Web Application clients require `client_secret` on the token endpoint even when using PKCE — browser-side code exchange is not possible for this client type. The 8-B spec assumed PKCE would work without a server component; this assumption should be verified against provider docs before spec sign-off. **Action:** Add a note to the 8-C spec and future auth slices: for Google Web Application OAuth, token exchange must go through a backend endpoint. — Done (documented in phase-8.md under 8-C notes; `GOOGLE_CLIENT_SECRET` env var wired through CDK and CI).

- A new UI element added directly to a CSS grid parent (`app-layout`) disrupted the entire column layout because grid auto-assigns children to columns sequentially. The sign-out button occupied the first 220px column, shifting the sidebar and main content by one cell. **Action:** When adding elements to `.app-layout` or any other explicit CSS grid, always verify the element is intentionally a grid child or nest it inside an existing child — Done (sign-out moved inside `<Sidebar>` via `onSignOut` prop).

- `GOOGLE_CLIENT_SECRET` was added to GitHub Actions secrets after a deploy had already started; that run baked in an empty string for the secret. Required an extra empty commit to force a re-deploy. **Action:** Add a note to the deploy checklist — any secret that the CDK deploy step reads must be set in GitHub Actions *before* pushing the commit that enables it — TODO (human decision: whether to add a pre-deploy secret validation step to CI).

## Applied status

| Learning | Status |
|---|---|
| 1. Google Web App OAuth needs backend token exchange | Applied — `POST /auth/token` endpoint in `src/Api/Endpoints/AuthEndpoints.cs`; `GOOGLE_CLIENT_SECRET` in CDK stack and `deploy.yml` |
| 2. CSS grid children must be intentional | Applied — sign-out button moved inside Sidebar via `onSignOut` prop; `margin-top: auto` pins it to the bottom of the nav |
| 3. Secrets must exist before the deploy that reads them | Documented — requires human decision on whether to add a CI validation step |
