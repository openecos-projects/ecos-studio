---
status: accepted
---

# Flow Step identities remain distinct across product surfaces

ECOS Studio projects each ECC Flow Step under its own identity and order across Workspace views, logs, analysis and Project Comparison. `Timing optimization`, `LEC` and `postRouteLec` are not folded into `Legal`, `Synthesis` or `Filler`; spelling normalization may recognize aliases for the same step, but status-merging heuristics must not combine distinct engineering stages or attach their results to neighboring steps.
