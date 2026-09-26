# Current Kiara diagrams

These diagrams describe application code at **`74823e4` (26 September 2026)**. Start with the overview, then read the [eight-layer explanation](../README.md). A diagram describes implemented control flow; it does not assert that a successful live acceptance or strategy promotion has been observed.

![Current overview](01-system-overview.png)

## Current execution views

| Diagram | Question it answers | Source / exports |
| --- | --- | --- |
| **1. System overview** | How does an event become a reviewed document, and where does learning fit? | [Mermaid](01-system-overview.mmd) · [SVG](01-system-overview.svg) · [PNG](01-system-overview.png) |
| **2. Event-to-approval sequence** | Who calls whom, what is saved, and when do humans act? | [Mermaid](02-event-approval-sequence.mmd) · [SVG](02-event-approval-sequence.svg) · [PNG](02-event-approval-sequence.png) |
| **3. Processing and recovery** | What are the principal states, repair paths and pauses? | [Mermaid](03-workflow-state-machine.mmd) · [SVG](03-workflow-state-machine.svg) · [PNG](03-workflow-state-machine.png) |
| **3b. Notifications** | Why does a preview or delivered email never approve a document? | [Mermaid](03b-notification-state-machine.mmd) · [SVG](03b-notification-state-machine.svg) · [PNG](03b-notification-state-machine.png) |
| **3c. Human review and feedback** | How do edits, verified facts and the two approvals interact? | [Mermaid](03c-review-state-machine.mmd) · [SVG](03c-review-state-machine.svg) · [PNG](03c-review-state-machine.png) |
| **5. Harness learning** | What may change, how is it evaluated, and when can it become active? | [Mermaid](05-harness-adaptation.mmd) · [SVG](05-harness-adaptation.svg) · [PNG](05-harness-adaptation.png) |
| **6. Deployment and storage** | What actually runs on Vercel and what is stored in Atlas? | [Mermaid](06-deployment-and-storage.mmd) · [SVG](06-deployment-and-storage.svg) · [PNG](06-deployment-and-storage.png) |

The state diagrams summarize the main paths; they are not an exhaustive transition registry. Runtime calls can perform multiple checks before committing the next visible state. Universal terminal failures and provider bookkeeping are covered in the guide rather than repeated on every edge.

## Historical schema views

The existing `04a`–`04e` diagrams are **pre-implementation logical schema designs**, not the current public physical schema. They remain at their old paths for existing links. In production public mode, `demo_workspaces` holds each visitor's state; see diagram 6 and `src/data/store.ts`. The alternate private projection catalog is in `src/data/physical.ts`.

- [Context design](04a-schema-context.svg)
- [Documents/review design](04b-schema-documents.svg)
- [Operations design](04c-schema-learning-operations.svg)
- [Harness design](04d-schema-harness.svg)
- [Legal-source design](04e-schema-legal-sources.svg)

The entire previous diagram set is preserved in [the design archive](../history/design-diagrams/). Its seeded-failure sequence, two-flag optimizer and build-owner labels describe the earlier plan, not the live agent runtime.

## Re-rendering

The `.mmd` files are editable Mermaid and render directly in supporting Markdown viewers. SVGs preserve scalable text; PNGs are convenient for previews. Render the seven current diagrams with the official Mermaid CLI (this snapshot used `@mermaid-js/mermaid-cli` 11.12.0):

```sh
# With mmdc on PATH:
node kiara-architecture/diagrams/render.mjs

# Or point at a separately installed renderer and its browser configuration:
MERMAID_CLI=/path/to/node_modules/.bin/mmdc \
MERMAID_PUPPETEER_CONFIG=/path/to/puppeteer-config.json \
node kiara-architecture/diagrams/render.mjs
```

A Puppeteer configuration can specify `executablePath` for an installed Chrome/Chromium. Rendering uses a separate headless process and does not need application credentials, database access or model calls. [Theme configuration](mermaid-config.json) controls typography; [render manifest](render-manifest.json) records source/output hashes. This tooling is separate from application dependencies.
