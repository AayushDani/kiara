# Kiara diagram pack — phase-one integration candidate

This is a **provisional design pack**, owned by T15. T17 copies final artifacts only after frozen-schema alignment and independent review. No application was built or tested by this work.

![System overview](diagrams/01-system-overview.svg)

The overview has 14 meaningful nodes and visibly accounts for C01–C18 through named groups. Each node names its implementation package. Ixx packages are future build assignments, not already-created implementation chats. See [component registry](component-registry.json) for ownership, location, responsibilities, inputs, outputs, backing data and acceptance checks.

| Required view | Editable Mermaid | SVG / preview |
|---|---|---|
| System overview | [01](diagrams/01-system-overview.mmd) | [SVG](diagrams/01-system-overview.svg) · [PNG](diagrams/01-system-overview.png) |
| Event and approval sequence | [02](diagrams/02-event-approval-sequence.mmd) | [SVG](diagrams/02-event-approval-sequence.svg) · [PNG](diagrams/02-event-approval-sequence.png) |
| Workflow: processing | [03](diagrams/03-workflow-state-machine.mmd) | [SVG](diagrams/03-workflow-state-machine.svg) · [PNG](diagrams/03-workflow-state-machine.png) |
| Workflow: human gates / terminal exits | [03c](diagrams/03c-review-state-machine.mmd) | [SVG](diagrams/03c-review-state-machine.svg) · [PNG](diagrams/03c-review-state-machine.png) |
| Workflow: independent notification state | [03b](diagrams/03b-notification-state-machine.mmd) | [SVG](diagrams/03b-notification-state-machine.svg) · [PNG](diagrams/03b-notification-state-machine.png) |
| Schema: context and assessment | [04a](diagrams/04a-schema-context.mmd) | [SVG](diagrams/04a-schema-context.svg) · [PNG](diagrams/04a-schema-context.png) |
| Schema: documents and review | [04b](diagrams/04b-schema-documents.mmd) | [SVG](diagrams/04b-schema-documents.svg) · [PNG](diagrams/04b-schema-documents.png) |
| Schema: jobs, runs, notifications | [04c](diagrams/04c-schema-learning-operations.mmd) | [SVG](diagrams/04c-schema-learning-operations.svg) · [PNG](diagrams/04c-schema-learning-operations.png) |
| Schema: harness and evaluation | [04d](diagrams/04d-schema-harness.mmd) | [SVG](diagrams/04d-schema-harness.svg) · [PNG](diagrams/04d-schema-harness.png) |
| Schema: legal sources | [04e](diagrams/04e-schema-legal-sources.mmd) | [SVG](diagrams/04e-schema-legal-sources.svg) · [PNG](diagrams/04e-schema-legal-sources.png) |
| Harness adaptation | [05](diagrams/05-harness-adaptation.mmd) | [SVG](diagrams/05-harness-adaptation.svg) · [PNG](diagrams/05-harness-adaptation.png) |

S means synchronous call; A asynchronous event or durable job; D data read/write; H explicit human action. Letter labels, actor shapes and process labels supplement color. ER crow's-foot notation has its own legend. Sequence dashed arrows also show labeled responses; the message label determines the interaction type.

[D01–D31 crosswalk](edge-contract-crosswalk.json) maps application interactions to actual owner draft contracts or explicitly named internal operations. Slash labels such as D05/06 compose two edges for a grouped overview. C06 remains the deterministic orchestrator even when a grouped edge goes from a model/validator node to a document node. D21 is drawn in data-response direction on the overview. D30/D31 expose the typed fact-proposal and authorized context-write boundary in the detailed crosswalk.

[R01–R35 schema mapping](schema-mapping.json) distinguishes logical entities from physical collections and embeds. Logical diagram fields are illustrative keys, not a replacement validator. The final physical schema and champion representation remain a T04/T17 reconciliation dependency.

Render with `node render.mjs`, then run `python3 check-artifacts.py` from this directory. The renderer uses installed Mermaid 11.17.2, local headless Chromium and blocked page network requests. It never contacts a public renderer. Set `KIARA_MERMAID_ROOT`, `KIARA_RENDER_NODE_MODULES` and `KIARA_RENDER_CHROME` for another machine; recorded local paths are defaults, not portable application dependencies. Set `KIARA_RENDER_FILE` only for an individual preview; a handoff render must include all files. `look: classic`, `handDrawnSeed: 1515` and deterministic IDs are pinned; repeated SVG hashes were checked.

[Report](report.md) distinguishes verified facts, design decisions, checks actually run, limitations and the next integration gate. [Check results](checks/artifact-checks.json) and [renderer manifest](checks/render-manifest.json) are machine readable.
