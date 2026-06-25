# Goals

The note taker is moving from a learning vehicle to a product to be operated long term. Optimise for **long-term supportability** — coding standards and architecture that sustain performance, resilience, and support — over learning surface area or shipping velocity.

> Origin: this began as a learning project (event sourcing, .NET on AWS serverless, agentic dev workflows). That history explains many existing choices; it no longer drives new ones.

## Primary goals — productionise

| Goal | What it means |
|------|---------------|
| **Maintainable architecture** | Clear boundaries, minimal accidental complexity, choices that a future maintainer can reason about and extend. |
| **Code quality standards** | Consistent conventions, strong test coverage, no dead or contract-lying code; quality gates enforced in CI. |
| **Performance** | Acceptable latency and cost under real usage; measure before optimising, but treat regressions as defects. |
| **Resilience** | Graceful failure handling, no silent data loss, recoverable from partial failures. |
| **Supportability / operability** | Production observability — logs, traces, metrics, alarms — so issues are diagnosable without code spelunking. |
| **Production auth & multi-user** | Real authentication and per-user data isolation, production-ready. |

## Secondary

- **Continued learning** — event sourcing, .NET on AWS serverless, and agentic dev workflows remain valuable to practise, but no longer justify a harder path when a simpler production-ready one exists.

## How this affects choices

When in doubt, choose the option that is **easiest to support and operate long term**:

- Prefer mature, well-understood approaches over bespoke ones built for learning's sake — unless the bespoke piece is already load-bearing and sound.
- Treat observability, error handling, and tests as part of every slice, not an afterthought.
- Pay down complexity that a future maintainer would trip over; resist adding complexity that only earns its keep as a learning exercise.
- Keep the event-sourcing core where it serves the product; do not extend it purely to explore it.
