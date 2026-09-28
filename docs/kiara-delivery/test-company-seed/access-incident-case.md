# Test Recruiter · access alert exercise `ALERT-TEST-001`

Status: authored tabletop scenario, not an observed alert, breach, notification, or completed incident response. Version: 1, 2026-09-28.

## Scenario

At fictional time 2026-09-23T08:15:00Z, an access monitor would flag a query by recruiter seat `REC-TEST-001` for candidate `CAND-TEST-001` after `VIS-TEST-002` switched that profile to private on 2026-09-20. The associated employer `EMP-TEST-001` has only an unsigned order worksheet and no provisioned seat. The correct test expectation is denial before profile content or a vector-derived snippet is disclosed. This pack contains no actual query, network log, exposure, or third-party recipient.

## Triage worksheet

| Step | Evidence to preserve or decision to make | State in this exercise |
| --- | --- | --- |
| Contain | Check seat entitlement and disable any misprovisioned access | Pending; no seat actually provisioned |
| Establish facts | Correlate identity, request time, profile visibility version, search filter, response payload, exports, and recruiter message logs | Missing live logs; exposure cannot be asserted |
| Scope | Search for other private candidates and cached/vector results in same time window | Pending simulated query |
| Preserve | Restrict access to minimal audit evidence and hash relevant logs/response artifacts | No artifact captured |
| Assess | Security owner and counsel decide incident classification, contractual and jurisdictional notice duties | No breach determination or notification |
| Correct and verify | Fix access filter/entitlement, replay denied-query test, check indexes and restore behavior | No remediation performed |

For this sample, the case remains `tabletop_open`. A plausible-looking alert description is not proof of data disclosure. The scenario tests the interaction of `profile-visibility-history.md`, `employer-order.md`, `vendor-data-inventory.md`, and `privacy-operations.md`.
