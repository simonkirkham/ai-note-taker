# Goals

This is a learning project, not a product. The note taker is the vehicle; the learning is the point.

## Primary learning goals

- **Agentic dev workflows** — moving from role-based agent teams to spec-and-capabilities driven workflows, with reflection captured as a first-class output.
- **Event sourcing** — designing aggregates, events, and projections in a real system rather than reading about it.
- **Hands-on coding skills** — sustained build practice across .NET backend, React frontend, and CDK infra.

## Secondary

- A working, useful note-taking app focused on meetings.

## Explicit non-goals (year one)

- Polished UX
- Multi-user / production-ready auth (deferred to final phase)
- Performance optimisation
- Marketplace-style integrations beyond Google Calendar

## How this affects choices

When in doubt, choose the option that maximises learning surface area:

- Build the event-sourcing primitives ourselves on DynamoDB rather than reach for the easiest mature library.
- Use React + TypeScript rather than Blazor — stretches beyond the .NET comfort zone.
- Use CDK in C# rather than YAML — adds infra-as-code as a deliberate fourth learning track.
