# Observed legal sources and reviewed applicability

Product contract: v2 §§8, 13 and 16. Source monitoring is a public read under a protected operator policy. Observing changed text does not decide legal applicability, create a company fact, approve a playbook or authorize an external action.

## Configuration and worker

`KIARA_V2_LEGAL_SOURCE_POLICY` is a JSON list. Each tenant entry contains exactly `tenantId`, `urls`, `validUntil` and `maxBytes`. The URL list is exact, contains at most 100 selected HTTPS URLs, and must be approved by the deployment's content/operations owners. `validUntil` is a future ISO timestamp. `maxBytes` is 1–1,000,000. No matching current policy means unavailable monitoring. No credentials are sent to these public sources.

A current legal reviewer can configure a watch against the inspected authority version with a 1–720 hour interval. The same transaction stores its outbox reference. Local and Temporal workers call the same processor; workflow histories carry identifiers and status only. A changed policy, owner membership or source authority must be inspected again. Source/member withdrawal stops the affected watch; temporary read/configuration failures remain blocked and visible. Replay and pending leases do not launch overlapping checks.

The production reader resolves the configured hostname once, rejects private/special addresses, and pins a public address to a fresh TLS connection with the original hostname verification. It follows no redirects, sends no authentication, and bounds DNS, request duration, body size and extracted text. Text and UTF-8 HTML are supported. Compressed, binary/PDF, excessive or invalid representations remain explicitly unsupported instead of being silently treated as reviewed text. HTML extraction is a review aid, and encrypted original bytes are retained for changed observations.

## Changed-source workflow

1. A monitor records a new source version with unknown authority and exact original bytes, then records old/new source hashes and an unassessed change. It expires the registered authority's review freshness. Existing sources remain intact. Automatic indexing still needs its separate standing policy and spending authorization.
2. Current coverage stays stale while a change is pending, even if someone re-verifies the old source. The change is visible only within the source's permission lineage.
3. A legal reviewer inspects the exact old/new texts and hashes and records a reasoned assessment. A no-applicability-change assessment has no affected targets. An affected-work assessment explicitly names readable matters or learning records with the same audience. Canceled and legacy-owned matters cannot be reopened through this path.
4. Selected matters receive an owned legal-review task and stale proposal/action approvals are invalidated. Already dispatched/uncertain effects remain retained for reconciliation. Selected promoted lessons retain promotion history but require renewed owner review; monitoring does not roll them back or confer the owner's promotion authority.
5. Adopting the observed source is a separate explicit choice within that reviewed assessment. It clears source verification and makes dependent coverage pending review. Source verification and coverage qualification must then be recorded again through their existing human-capacity controls. No qualified legal assessment is fabricated by the software.

Company exposes monitoring availability as **operator policy configured**, not provider connectivity or legally valid coverage. The pending work list, watch status and applicability review controls are distinct from an authoritative legal answer. The exact source's raw bytes can be downloaded through existing scoped-original controls. Source deletion also redacts observed versions, assessment reasons and monitoring URLs and stops future checks; backup/provider retention remains a separate deployment responsibility.

## Qualification

The focused `tests/v2-legal-maintenance.test.ts` uses fictional source content and injected HTTP responses. It covers admission, scheduled replay, policy revocation without a read, observed bytes, current-freshness blocking, exact assessment, source adoption, stale version rejection, source withdrawal during a read, unsupported/oversized responses, lineage deletion and public-address validation. `tests/v2-legal-orchestration.test.ts` checks reference-only worker inputs, durable defer and stop behavior. These are local and injected-provider tests; no public legal site, paid provider or customer source was fetched for qualification.

Independent regression review checked the actual transport, role checks, late authority revalidation, applicability controls and provider-evidence boundaries. It found the shared-agent socket reuse risk; the repaired reader uses `agent:false`. A real selected-source read, deployment policy, content-owner selection, qualified legal-review ownership and monitored-source operational evidence remain external prerequisites.
