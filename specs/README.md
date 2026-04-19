# CTO Dashboard Specifications

Living documentation for the CTO Dashboard codebase. **These specs must be updated whenever features are added, modified, or removed.**

## Spec Files

| File | Description |
|------|-------------|
| [architecture.md](./architecture.md) | System architecture, tech stack, deployment topology |
| [pages.md](./pages.md) | All frontend pages — routes, components, behavior |
| [components.md](./components.md) | Reusable UI components — props, rendering, interactions |
| [server.md](./server.md) | Server modules — orchestrator, CTO session, engineer pool, task queue |
| [websocket-protocol.md](./websocket-protocol.md) | Complete WebSocket message protocol (client <-> server) |
| [data-models.md](./data-models.md) | Firestore collections, TypeScript interfaces, data schemas |
| [integrations.md](./integrations.md) | External service integrations — Notion, GitHub, Slack, Vanta, Twilio, GCP |
| [state-management.md](./state-management.md) | Zustand stores, hooks, frontend state flow |
| [configuration.md](./configuration.md) | Config system, environment variables, secrets management |
| [prompts.md](./prompts.md) | CTO and Engineer system prompts — structure and context injection |
| [deployment.md](./deployment.md) | Docker, Cloud Run, CI/CD, production server |

## Maintenance Rules

1. **When adding a new page**: Update `pages.md` and `websocket-protocol.md`
2. **When adding a component**: Update `components.md`
3. **When adding a WebSocket message type**: Update `websocket-protocol.md` and the relevant page/server spec
4. **When changing the data model**: Update `data-models.md`
5. **When adding an integration**: Update `integrations.md` and `configuration.md`
6. **When changing config fields**: Update `configuration.md`
7. **When modifying prompts**: Update `prompts.md`
8. **When changing deployment**: Update `deployment.md`
