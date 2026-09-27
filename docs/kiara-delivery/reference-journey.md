# Synthetic Northstar/RelayAI reference journey

`tests/v2-reference-journey.test.ts` is a partial synthetic control-path trace across one persistent local tenant. It touches the J01–J10 sequence but does not qualify every acceptance condition in those steps. It uses public service commands, signed synthetic GitHub and Slack webhooks, and a synthetic Slack readback adapter. Network calls fail by default. The fixture is fictional and records no customer result.

| Step | Evidence in the trace |
|---|---|
| J01–J03 | A founder's question creates an isolated scenario; editing and adopting it creates one matter while company facts remain empty. The first answer therefore does not demonstrate citations to current company context. |
| J04 | Signed PR and launch-message observations remain unlinked until the named owner links both to the existing matter. Neither observation confirms deployment; separate engineering confirmation of actual deployment, vendor terms and location is outside this trace. |
| J05 | The owner confirms exact planned facts and attests the supplied agreement register. A named synthetic legal reviewer records an exact Acme clause, target and conditional notice fields; the prepared proposal retains coverage unknowns. |
| J06 | A newly mapped Slack member asks why the matter matters. The scoped answer has an in-app link to the same matter and is verified against a synthetic Slack readback. |
| J07–J08 | The owner records fictional existing-counsel intake, terms and packet sharing. A returned revision supersedes the previous proposal and requires new exact decisions. This test does not exercise the UI preview of named counsel and shared material. |
| J09 | Business and legal-role decisions bind the returned bytes. An exact send action has a future start; early attestation fails and completion remains pending. This trace does not include a distinct publisher decision, execution evidence or the owned unresolved-work branch. |
| J10 | A fact-owner correction invalidates the earlier proposal. Attributed wording feedback is retained, and a later comparable matter sees the corrected planned fact while retaining its own review unknowns. This trace does not evaluate, approve, promote or roll back a reusable lesson. |

**Limits:** The legal-role decisions and clause assessment are synthetic control-path inputs, not qualified legal advice or real clearance. The agreement inventory covers only supplied fictional records. No external email or publication occurs, and the future action is not represented as complete. Feedback is recorded but no reusable learning rule is evaluated or promoted; the later matter demonstrates current scoped fact reuse only. Separate focused suites and browser reviews cover some omitted controls; the [qualification index](qualification-status-sep27.md) keeps those findings distinct from this trace. Live provider installation, customer access, timing, counsel qualification and delivery require separate validation.

Verification: `node --import tsx --test tests/v2-reference-journey.test.ts` passed 1/1 under Node 24; `npm run check` passed.
