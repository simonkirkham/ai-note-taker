# ADR 0003 — Frontend on React + TypeScript

**Status:** Accepted

## Context

Frontend stack choice. Three realistic options for someone with .NET background and light JS/TS experience:

- **Blazor** — stay in .NET land, share types with the backend.
- **React + TypeScript** — industry standard, broadest learning value, AI coding agents are sharpest in this ecosystem.
- **Next.js** — React with conventions and routing baked in.

## Decision

Use **React + TypeScript** with **Vite** as the build tool.

## Consequences

- Stretches beyond the .NET comfort zone — explicit learning value.
- Coding agents perform best in JS/TS, which directly supports the agentic-workflow learning goal.
- Need to ramp on JS tooling (Vite, npm, ESLint, etc.).
- No type sharing with the backend — accepted; types regenerated or duplicated as needed.

## Alternatives considered

- **Blazor** — keeps the language consistent but works against the learning goal of stretching beyond .NET. Smaller agent training corpus than React.
- **Next.js** — fine, but adds opinions we don't need yet. May revisit if SSR or routing complexity grows.
