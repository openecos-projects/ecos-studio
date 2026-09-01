# ECOS Agent FSE Published-Work Comparison Plan

Updated: 2026-08-26

## 1. Decision

ECOS Agent should be evaluated as an authority-utility study, not as the first
LLM-based EDA optimizer. The main question is whether an LLM that may propose
only a context-bound, value-free strategy direction retains useful terminal
optimization performance when deterministic software owns numerical selection,
authorization, execution, and replay.

External systems use different tools, action spaces, and budgets. Their reported
numbers must not be compared directly with ECOS results. The main experiment
should implement their decision paradigms inside the same ECOS harness and label
them as method-style baselines unless the original artifact is reproduced in its
published environment.

## 2. Published Work Requiring Experimental Comparison

| Priority | Published work | Publication | ECOS comparison condition | Purpose |
|---|---|---|---|---|
| P0 | [ORFS-agent](https://doi.org/10.1109/MLCAD65511.2025.11189204) | MLCAD 2025 | Direct-Numeric LLM | Compare against an EDA flow agent that directly generates knob values from history and terminal QoR. |
| P0 | [CAPO](https://doi.org/10.1145/3787109.3816403) | GLSVLSI 2026 | Bounded-Action LLM with magnitude | Compare direction-only authority against certified selection from a bounded action and magnitude library. |
| P0 | [HyperPlace](https://doi.org/10.1145/3733601) | ACM TODAES 2025 | Direct-Numeric LLM | Cover low-sample placement tuning where the LLM directly proposes parameter values. This may share one implementation with the ORFS-agent-style condition. |
| P0 | [SysInsight](https://doi.org/10.14778/3797919.3797940) | PVLDB 2026 | Semantic direction plus local numerical policy | Address the closest published precedent for LLM-generated increase/decrease hypotheses followed by non-LLM numerical tuning. |
| P1 | [CROP](https://doi.org/10.1109/ICCAD66269.2025.11240643) | ICCAD 2025 | Retrieval-Guided Policy | Test whether retrieval and similar-design guidance add value beyond deterministic rules and no-knowledge LLM planning. |
| Conditional | OpenROAD METRICS2.1 / Flow Tuning | ICCAD 2021, [DOI](https://doi.org/10.1109/ICCAD51958.2021.9643541) | One mature non-LLM autotuner | Required if the action space is expanded or the paper claims superiority over general autotuning. |

ORFS-agent and HyperPlace do not need two separate ECOS implementations when
both reduce to the same controlled condition: the same model directly returns a
value from the same frozen ECOS lattice. CAPO requires a distinct intermediate
authority level because it allows more numerical choice than ECOS direction-only
planning but less freedom than direct numerical generation.

## 3. Minimum Main-Table Methods

1. `Default ECOS`: no intervention.
2. `Controlled Coordinate Search`: fixed non-LLM knob and direction order.
3. `Random Action Search`: same legal action space with frozen seeds.
4. `Rule-Guided Direction`: deterministic knowledge-card rules without an LLM.
5. `LLM-NoKnowledge`: observations and history without retrieved knowledge.
6. `Direct-Numeric LLM`: ORFS-agent/HyperPlace-style numerical authority.
7. `Bounded-Action LLM`: CAPO-style action and magnitude selection.
8. `Full Agent: Direction-Only`: the ECOS method.
9. `Offline Exhaustive Oracle`: analysis-only upper bound and regret reference for the small lattice.

For the current three-knob, 20-candidate Gate 0, coordinate search, random
search, and the exhaustive oracle are more interpretable than a full BO suite.
If the knob space grows or the paper makes an optimization-algorithm claim, add
one mature implementation such as TPE, SMAC, or the applicable OpenROAD
AutoTuner configuration. One implementation is sufficient; running all three
does not answer an additional ECOS research question.

## 4. Published Work for Related Work and Experimental Design

These papers establish prior mechanisms but should not be executed as terminal
QoR baselines because their tasks are not comparable to ECOS physical-design
parameter optimization.

| Work | Publication | Relevance |
|---|---|---|
| [GPTuner](https://doi.org/10.14778/3659437.3659449) | PVLDB 2024 | Text knowledge to knob/range selection and Bayesian optimization. |
| [LLAMBO](https://openreview.net/forum?id=OOxotBmGol) | ICLR 2024 | LLM-enhanced Bayesian optimization under sparse observations. |
| [OPRO](https://openreview.net/forum?id=Bb4VGOWELI) | ICLR 2024 | History-and-score-conditioned direct LLM optimization. |
| [Agentless](https://doi.org/10.1145/3715754) | FSE 2025 | Strong motivation for comparing a complex Agent against simple fixed pipelines. |
| [SWE-agent](https://doi.org/10.52202/079017-1601) | NeurIPS 2024 | Constrained agent-computer interfaces as a utility mechanism. |
| [AgentDojo](https://doi.org/10.52202/079017-2636) | NeurIPS 2024 | Utility-security trade-off and deterministic state oracles. |
| [ToolSandbox](https://doi.org/10.18653/v1/2025.findings-naacl.65) | NAACL Findings 2025 | Stateful tool-use evaluation with required and forbidden state transitions. |
| [ChatEDA](https://doi.org/10.1109/TCAD.2024.3383347) | IEEE TCAD 2024 | Evidence that autonomous EDA agents already exist; it is not an iterative terminal-QoR optimizer. |

## 5. Preprint Boundary

AgenticPD, GoalEvolve, Retrieve-Schedule-Reflect, AutoEDA, FluxEDA,
CLOSER-Bench, and POSTEDA-BENCH are relevant recent work, but the current
evidence records them as preprints. They must not be described as formally
published baselines unless their publication status is reverified before
submission. They may be discussed as recent concurrent work.

## 6. Fair Comparison Contract

All executable conditions must share:

- the same designs, PDK, tool versions, baseline checkpoint, and action lattice;
- the same limit of 20 side-effecting candidate executions;
- the same wall-time and, for LLM methods, planning-call budgets;
- the same fixed `candidate.rerun` execution boundary and terminal endpoint;
- the same DRC, LVS, RCX, STA, artifact, and incumbent eligibility checks;
- the same rule that every started execution, timeout, indeterminate result, and
  ineligible terminal result consumes candidate budget;
- frozen prompts, model identifiers, knowledge hashes, seeds where supported,
  and deterministic local numerical selection outside the authority condition
  under study.

The primary utility results should report `lex_success@20`, `success@k`,
best-so-far terminal QoR, design-blocked win/tie/loss, failure categories, and
wall time. The control axis should report unauthorized accepted actions,
invalid proposals, post-rejection side effects, terminal receipt completeness,
manifest completeness, ledger verification, and replay fidelity.

Every `terminal-Harden` observation uses the following metric roles:

| Role | Metrics | Decision effect |
|---|---|---|
| Objective | Detailed-route violations, layer-assignment overflow, routed wirelength | Frozen lexicographic incumbent comparison |
| Timing guardrail | Worst setup/hold WNS and TNS across configured corners | Reject a meaningful regression before objective comparison |
| Eligibility | Numeric DRC/LVS, RCX/STA coverage and violations, Harden completeness | Candidate must pass |
| PPA report | Standard-cell area, typical and worst-corner dynamic/leakage power | Report only |
| Diagnostics and cost | Via/patch counts, place-to-Harden tool runtime and peak memory | Report only |
| Corner robustness | Per-corner timing and power vector plus corner-set hash | Audited artifact, not a weighted score |

PPA, diagnostics, cost, and corner-robustness metrics do not enter the
lexicographic objective. Their source paths, units, corners, and metric roles
are bound into the terminal observation and its artifact manifest.

## 7. Execution Order and Go/No-Go

1. Repair the baseline contract so Default and every method are compared through
   an equivalent execution path.
2. Pass a task-discriminability Gate 0 before running the full comparison.
3. Run deterministic non-LLM baselines first.
4. Run the authority ladder: direct numeric, bounded action, and direction only.
5. Run knowledge and history ablations only after the main task is discriminative.
6. Add one mature autotuner only when the expanded scope requires it.

The retired gcd/i2c pilot runner is not an execution path for this plan. Future
baseline evaluation must use the current frozen design manifest and equal-budget protocol.

The FSE research claim should continue only if the Full Agent produces a stable
terminal-utility or control-utility finding across designs. If coordinate,
random, or rule-guided search matches the Full Agent, the result should be
reported as evidence that the Agent is unnecessary for the frozen task rather
than reframed as an optimization success.
