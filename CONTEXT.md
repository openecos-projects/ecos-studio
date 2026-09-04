# Agent Interaction

This context defines the structured requests and answers exchanged between the ECOS Agent and GUI. Agent interactions may propose bounded product actions, while ECOS Studio retains confirmation, validation and execution authority.

## Language

**Workspace Parameter Update Proposal**:
A user-confirmable Agent proposal containing canonical parameter identities and values together with its target Workspace Handle, expected Workspace Revision and command identity. It never names or edits configuration files and does not execute until ECOS Studio submits a validated Workspace Configuration Update.
_Avoid_: parameter file write, JSON patch, Agent workspace mutation

**Step Configuration Update Proposal**:
A user-confirmable Agent proposal containing a Flow Step identity and bounded configuration patch together with its target Workspace Handle, expected Workspace Revision and command identity. It never names a tool configuration file or JSON path and executes only through ECOS Studio's validated Step Configuration Update command.
_Avoid_: step config file write, arbitrary JSON edit, Agent filesystem mutation
