# Synthetic Northstar/RelayAI reference journey

`tests/v2-reference-journey.test.ts` is a partial synthetic control-path trace across one persistent local tenant. It touches the J01–J10 sequence but does not qualify every acceptance condition in those steps. It uses public service commands, signed synthetic GitHub and Slack webhooks, and a synthetic Slack readback adapter. Network calls fail by default. The fixture is fictional and records no customer result.

| Step | Evidence in the trace |
|---|---|
| J01–J03 | A founder's question receives an answer citing a supplied current Northstar support record, then creates an isolated scenario. Editing and adopting it creates one matter while company facts remain empty; no deployed RelayAI fact is invented. |
| J04 | Signed PR and launch-message observations remain unlinked until the named owner links both to the existing matter. A separate engineering actor confirms planned data flow and explicitly unconfirmed deployment; vendor terms and location remain unconfirmed. |
| J05 | The owner confirms exact planned facts and attests the supplied agreement register. A named synthetic legal reviewer records an exact Acme clause, target and conditional notice fields; the prepared proposal retains coverage unknowns. |
| J06 | A newly mapped Slack member asks why the matter matters. The scoped answer has an in-app link to the same matter and is verified against a synthetic Slack readback. |
| J07–J08 | The owner records fictional existing-counsel intake, terms and packet sharing. A returned revision supersedes the previous proposal and requires new exact decisions. This test does not exercise the UI preview of named counsel and shared material. |
| J09 | Business and legal-role decisions bind the returned bytes. A distinct publisher authorizes an exact send action with a future start and owns its pending action task. Early attestation fails; no external send or completion is claimed. |
| J10 | A fact-owner correction invalidates the earlier proposal; attributed wording feedback remains a report. A separate exact-clause retrieval issue undergoes independent evaluation, no-effect observation and third-person promotion. Later comparable work reuses the settled planned fact without reconfirmation and gets the corrected ranking; rollback identifies its affected answer and restores baseline ranking. |

**Limits:** The legal-role decisions and clause assessment are synthetic control-path inputs, not qualified legal advice or real clearance. The agreement inventory covers only supplied fictional records. No external email or publication occurs, and the future action is not represented as complete. The promoted lesson is a bounded local exact-clause ranking rule, not generalized drafting or legal learning. This test does not exercise the UI preview of named counsel and shared material; separate browser review covers that control. Live provider installation, customer access, timing, counsel qualification and delivery require separate validation.

Verification: `node --import tsx --test tests/v2-reference-journey.test.ts` passed 1/1 under Node 24; `npm run check` passed.
