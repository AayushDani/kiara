# Test Jobs · candidate profile and visibility history

Status: authored synthetic pilot event ledger, not live candidate data or a verified product log. Version: 1, 2026-09-28. `CAND-TEST-001` is an invented identifier; no name, email, phone, address, or actual resume is present.

## Profile `PROF-TEST-001`

Candidate `CAND-TEST-001` declared Python, SQL, batch data pipelines, New York City or remote roles, and a target base range of USD 160,000–200,000. These values are invented to test matching and privacy answers. The `RESUME-TEST-001` reference is an empty attachment placeholder, not stored personal data. Test Match must not infer protected traits from this example.

| UTC time | Synthetic event | Resulting state | Evidence boundary |
| --- | --- | --- | --- |
| 2026-09-10T12:00:00Z | Profile created | `private` | Pilot design default; no employer discoverability |
| 2026-09-12T09:30:00Z | Candidate selected employer visibility | `visible_to_verified_employers` | Proposed choice event `VIS-TEST-001`; no proof a recruiter viewed it |
| 2026-09-15T14:10:00Z | Application draft `APP-TEST-001` saved | `visible_to_verified_employers` | Draft only; no employer delivery |
| 2026-09-20T17:45:00Z | Candidate turned employer visibility off | `private` | Proposed choice event `VIS-TEST-002`; future discovery should stop |
| 2026-09-22T10:00:00Z | Deletion request scenario opened | `private` | Case `PRIV-TEST-001` remains unverified and pending |

Current sample state is `private`. A visibility switch is not an application withdrawal or proof of deletion from earlier exports. This ledger has **no** recruiter search, message, export, application delivery, or external copy event. If a future integration supplies such an event, preserve its own time, recipient, payload, and authority instead of backfilling this synthetic history.
