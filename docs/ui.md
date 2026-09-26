# Kiara product UI

`src/ui/pages/KiaraApp.tsx` is the client entrypoint imported by the App Router page. It uses the typed server state directly; all workflow actions call the server. `src/ui/presentation.ts` contains pure display helpers and lossless clause comparison. `src/app/globals.css` is the responsive visual system.

The application has six workspace sections:

- **Overview:** actual internal policy version, pending decisions, fact count, harness version, recent events, and synthetic signup entrypoint.
- **Policy reviews:** selectable workflows, persisted progress, applicability criteria, unknown facts, visible failed/passed validation and repair history, ordered approvals, operational follow-ups, and optional technical pane. Tabs expose full clause redlines, retained legal sources, pinned company facts, and event/feedback history.
- **Company context:** searchable facts with known/unknown/conflicted state and provenance, retained policy version exports, pending founder fact verification.
- **Learning & guardrails:** active persisted harness configuration, fixed-case evaluation, safe promotion/rollback controls, result history, future-run feedback, and actual later workflow repair counts.
- **Notifications:** persisted outbox, explicit preview-versus-delivery states, and inspectable message body.
- **System & activity:** persistence/model/email modes, worker heartbeat, provider limitations, demo identity explanation, epochs, protections, and persisted events.

All visible writes use JSON POST requests, the session CSRF token, and a generated idempotency key. Workflow review commands carry the reset epoch, state version, and review bundle hash. The UI polls actual workspace state every second while jobs process and every five seconds while idle. It does not advance workflow stages or simulate approval locally.

## Product boundaries

The workspace is explicitly a synthetic demo. Local persistence is labeled separately from MongoDB. Scripted output is labeled separately from OpenAI. Email preview does not claim delivery. The role selector is a simulated session identity, not proof of separate human actors. Internal finalization does not claim publication or operational compliance.

Unknown facts are not rendered as false. Proposed policy language is labeled and separated from retained source text. Source modals show the official URL, effective/retrieval dates, and content/source hashes. Clause comparison retains full original and candidate content and labels additions, removals, changes, and unchanged clauses; it uses semantic `ins`/`del` markup, not color alone.

The four feedback categories remain separate: company fact correction, full clause edit, legal interpretation note, and future harness improvement. A company fact proposal needs founder verification. A wording edit creates a revision and reruns validation. Feedback itself does not silently change the harness.

## Accessibility implementation

Native buttons, selects, labels, tables, dialog roles, focus trapping/restoration, Escape dismissal, live status announcements, and arrow-key tab navigation are implemented. Statuses use text in addition to color. Responsive layouts should be checked on a real browser and keyboard; these mechanisms alone are not an accessibility audit.

## Verification

Run pure presentation checks with:

```sh
node --import tsx --test tests/ui/*.test.ts
```

These tests exercise the real full baseline/candidate fixtures, preserve removed clauses and heading-only changes, distinguish unknown from false/zero, and surface structured server errors. They are unit checks only, not browser or provider proof.

The integration lead owns browser acceptance and captures the actual persisted signup → validation/repair → founder → lawyer → finalization flow, structured feedback behavior, source/redline views, notifications, harness comparison, and later-event behavior. The UI author did not operate the browser while the integration lead controlled that shared session.
