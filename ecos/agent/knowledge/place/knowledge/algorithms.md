<a id="algorithm.place.execution"></a>
## algorithm.place.execution

**Execution path:** The ECOS `place` runner obtains the ECC module, constructs `DreamplaceModule`, builds `PlacementEngine`, imports the ECC-backed raw database with `setup_rawdb()`, builds the Python placement database, and invokes `NonLinearPlace`.

**Stage order inside one place invocation:** When the corresponding controls are enabled, the order is `global placement -> acceptance gate -> legalization -> detailed placement`. The acceptance gate runs after global placement; excessive overflow or a non-finite objective returns infinite HPWL and prevents later stages.

**Flow distinction:** ECOS also has a separate `legalization` flow step after CTS. That step invokes the same module with global placement disabled, so it legalizes its incoming placement rather than rerunning global placement.

**Post-processing boundary:** The runner requests feature maps, saves data, and runs analysis after DreamPlace returns. Those calls are not independent proof that every requested artifact was produced.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **dreamplace.placer**, **dreamplace.nonlinear**

<a id="algorithm.dreamplace.global_placement"></a>
## algorithm.dreamplace.global_placement

**Idea:** Global placement relaxes cells to continuous coordinates and minimizes a differentiable objective. `PlaceObj` combines smoothed wirelength with a density penalty, and can add a macro-overlap penalty. The weighted-average wirelength model supplies gradients where exact HPWL is not differentiable, while density and overflow are evaluated over placement bins.

**Optimization structure:** Each configured global stage runs **three nested optimization loops**: an outer gamma loop reduces wirelength smoothing, a middle loop updates density weight, and an inner loop performs optimizer descent. The selected optimizer can be Adam, SGD variants, or Nesterov; each descent step projects cells back into the placement boundary, evaluates HPWL and overflow, differentiates the objective, and preconditions gradients by density and node area.

**Convergence control:** The implementation tracks the best-overflow position, updates density weight and gamma as optimization progresses, stops on overflow/HPWL/density criteria, and can roll back after divergence detection. The final global-placement metric is the gate for later legalization and detailed refinement.

**Source evidence:** **dreamplace.nonlinear**, **dreamplace.objective**

<a id="algorithm.dreamplace.routability_optimization"></a>
## algorithm.dreamplace.routability_optimization

**Trigger:** When routability optimization is enabled, the global-placement loop considers area adjustment only after density overflow falls below its configured threshold and while adjustment rounds remain.

**Algorithm:** It obtains a routing-utilization map from EGR or the routing estimator, and optionally a pin-utilization map. `adjust_node_area_op` uses those maps to modify movable-cell area models so the following placement iterations can spread demand away from congested or pin-dense regions.

**Restart after adjustment:** After an area change, DreamPlace resets density and overflow operators, reinitializes density weight and the optimizer state, estimates a new learning rate, and resumes the nested optimization loop. These are placement-time estimators, not evidence of detailed-routing completion.

**Source evidence:** **dreamplace.nonlinear**, **dreamplace.objective**

<a id="algorithm.dreamplace.legalization"></a>
## algorithm.dreamplace.legalization

**Purpose:** Legalization converts continuous placement coordinates into legal site and row locations while honoring die bounds, fixed objects, and fence-region constraints.

**Internal sequence:** The standard legalization operator runs `MacroLegalize -> GreedyLegalize -> AbacusLegalize`. Macro legalization places movable macros first. Greedy legalization produces a fast overlap-free standard-cell placement. Abacus legalization then compacts rows to improve displacement while preserving legality. A legality check follows greedy legalization and another follows Abacus legalization; a failed check retains the earlier legal candidate.

**Fence regions and flow use:** Designs with fence regions use a per-region legalization operator and validate the merged result. The standalone ECOS `legalization` flow step uses this same legalization path without a preceding global-placement run.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **dreamplace.nonlinear**, **dreamplace.placer**

<a id="algorithm.dreamplace.detailed_placement"></a>
## algorithm.dreamplace.detailed_placement

**Precondition:** Detailed refinement runs only when enabled and starts from the legalized placement. Every candidate sequence is checked for legality, and an illegal result stops refinement at the last legal position.

**In-process refinement:** DreamPlace constructs an ABCDPlace-style sequence: `K-Reorder -> IndependentSetMatching -> GlobalSwap -> K-Reorder`. K-Reorder searches local cell permutations, independent-set matching permits non-conflicting moves in parallel, and global swap evaluates broader exchanges. The final K-Reorder restores local ordering after swaps.

**External refinement:** After the in-process placement engine reports finite HPWL, `PlacementEngine` can invoke a configured external detailed placer when its executable path exists. That external call is distinct from the internal ABCDPlace-style sequence.

**Source evidence:** **dreamplace.nonlinear**, **dreamplace.placer**
