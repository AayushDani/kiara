# Test · proposed system and vendor data inventory

Status: synthetic design inventory, not an installation audit or a list of contracted vendors. Version: 1, 2026-09-28. “Store” names are logical components of the proposed Test product; no endpoint, credential, region, signed agreement, or live transmission is represented.

| System / vendor category | Proposed data and purpose | Sample record links | Owner and unanswered proof |
| --- | --- | --- | --- |
| Identity and access | Candidate and recruiter identifiers, roles, session/security events | `CAND-TEST-001`, `REC-TEST-001` | Security owner; identity provider, region, MFA, deletion path unknown |
| Marketplace primary store | Profile, choices, job, application draft, messages if sent | `PROF-TEST-001`, `VIS-TEST-002`, `JOB-TEST-001`, `APP-TEST-001` | Product owner; schema, backups, tenant boundaries unverified |
| Search/vector index | Eligible profile/job text and derived embeddings for discovery/matching | No indexed Test production record asserted | Search owner; visibility filtering, stale-vector removal, provider terms unverified |
| Object store | Candidate resume attachments and employer files | `RESUME-TEST-001` is an empty placeholder | Platform owner; encryption, access, lifecycle unverified |
| Email/delivery provider | Candidate notices, recruiter invites, application notifications | No message or recipient in this pack | Operations owner; provider, suppression, retention unverified |
| Model/embedding provider | Proposed text embeddings and match suggestions | No provider call or training transfer asserted | AI owner; exact inputs, data use, regions, opt-out, deletion unverified |
| Analytics and audit | Event counts, access and choice history | `VIS-TEST-001/002`, `ALERT-TEST-001` are authored examples | Privacy/security owners; payload minimization, retention, access unverified |
| Backups and exports | Recovery and employer-directed export copies | No backup or export manifest supplied | Platform owner; inventory and erase/recovery behavior unverified |

Before using an external service or sending a real record, record the named vendor, contract/processing terms, data categories, geography, subprocessor chain, security controls, retention, deletion/export mechanism, and test result. The draft `data-processing-addendum.md` does not prove those terms exist. Use `retention-decision-register.md` and `privacy-request-case.md` to track decisions for each store.
