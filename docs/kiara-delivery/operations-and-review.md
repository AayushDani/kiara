# Customer operations and reviewed integration

This checkpoint adds usable obligations and effort records, exact counsel sharing, and restricted execution to the shared workspace. It does not complete the full v2 target or certify a provider deployment.

## Deadline and fulfillment authority

The business owner proposes an obligation, assigns a current participant, and records its date, authority type, source clause and calculation assumptions. Legal/contractual dates require an exact quote from a retained source and a legal reviewer’s version-bound decision. Launch/response targets use business-owner authority. These are explicitly reviewed date calculations, not automated legal-calendar conclusions.

The review basis includes fulfillment criteria and, when supplied, one exact action ID/hash. A different verified action in the same matter cannot satisfy that obligation. Legal/contractual fulfillment requires a legal reviewer’s attributed assessment; other work uses its named owner or business owner. Human attestations remain distinct from action read-back. Completion records retain whether fulfillment was recorded after the deadline. In-app overdue reminders can be acknowledged without completing the obligation. Required unresolved obligations block closure; stale legal dates also block execution.

Source/reviewer changes invalidate current eligibility. Source revocation denies the obligation and dependent matter content before index cleanup. A broader redacted recovery control plane remains outstanding.

## Human effort and comparisons

People can start/stop an elapsed timer or report actual minutes across setup, research, drafting, review, correction, coordination and execution. Timers include idle time. Only their owner can stop or void a record. One person cannot simultaneously run another timer or manually log overlapping work while their timer is active. Command replay does not duplicate entries; distinct manual reports remain attributed assertions and require human reconciliation if duplicated.

The business owner records one current comparable baseline, labeled observed comparable work or estimate, with scope and evidence. A successor retains the previous baseline. The comparison subtracts all recorded effort once from that baseline. It does not claim completeness, causal/customer-validated time savings, or financial savings.

## Independent findings repaired

- Platform reviewer: immutable local originals could be overwritten after key rotation. Key-specific paths and no-replace writes now preserve both references; recovery test restores the original key.
- Regression reviewer: an old counsel packet could disclose a newer proposal. Prepared proposal identity/content/dependencies, material matter context and every selected source/fact/document snapshot now bind sharing eligibility. Mismatch requires a new packet.
- Platform reviewer: any verified action could satisfy a legal obligation. Fulfillment now binds exact reviewed criteria/action identity and requires the relevant human capacity.
- Root reviewer: email dispatch did not bind the visible sender or preview/live mode. The execution preview and durable decision now pin action, account/mode configuration and actor membership. Final dispatch rechecks these after preparation.
- Root reviewer: holdout answers appeared in the author’s learning snapshot. Protected receipt custody and role-aware projection now hide those rows from the author, including an author who also has evaluator capacity.

## Verification at the integration checkpoint

- Pinned Node 24.19.0 `npm test`: **284/284 passed** in `evidence/integrated-suite.log`.
- `npm run check`: passed in `evidence/integrated-typecheck.log`.
- `npm run build`: passed with documented Next Webpack build in `evidence/production-build.log`; subsequent service/UI repairs have focused tests and typecheck and will receive the next assembled build.
- Counsel + obligations + measurement + amendment scope repair: **10/10**, `evidence/operations-counsel-repair.log`.
- Local localhost and 127.0.0.1 authentication: GET/POST 200 for legacy and v2, `evidence/loopback-auth-after.json`. Hosted origin validation remains strict.
- OIDC code flow, S3/KMS, connectors, Temporal and external effects have simulated/injected contract qualification. No paid calls or external deliveries were performed.
- Browser observations and viewports are in `product-acceptance.md`; the actual running preview is loopback only at `http://localhost:3091/`.

The CI definition uses the documented [checkout](https://github.com/actions/checkout) and [Node setup](https://github.com/actions/setup-node) actions, Node 24, isolated state, type generation/checks, local tests and a production build. CI is authored but has not run on a remote runner. OIDC follows [authorization code validation](https://openid.net/specs/openid-connect-core-1_0.html#CodeFlowSteps) and [S256 PKCE](https://www.rfc-editor.org/rfc/rfc7636); a real identity-provider browser cycle remains required.
