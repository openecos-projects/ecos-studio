# Context Map

## Contexts

- [Agent Interaction](./CONTEXT.md) — defines structured requests and answers exchanged between the ECOS Agent and GUI
- [Chip Backend GUI](./docs/gui-backend/CONTEXT.md) — defines the product language for implementation workspaces, engineering analysis, artifacts and comparison
- [Resource Management](./docs/resource-management/CONTEXT.md) — defines installed design resources and their availability to ECOS Studio

## Relationships

- **Agent Interaction → Chip Backend GUI**: Agent interactions may collect bounded user input for a chip-backend action, but the interaction protocol does not own or execute Project, Workspace, Flow Step or Signoff operations.
- **Resource Management → Chip Backend GUI**: Resource Management supplies PDK Installations to backend Workspaces; Workspaces reference those installations but do not own them.
