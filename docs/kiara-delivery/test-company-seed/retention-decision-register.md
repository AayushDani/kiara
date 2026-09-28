# Test · retention decision register

Status: synthetic decision worksheet; **no retention period or hold is approved**. Version: 1, 2026-09-28. This register is deliberately specific about missing decisions so a plausible number is not mistaken for a legal rule.

| Record class | Sample ID | Proposed trigger to decide | Open decision and accountable role |
| --- | --- | --- | --- |
| Candidate profile and visibility events | `PROF-TEST-001`, `VIS-TEST-001/002` | Account closure or verified deletion request | Privacy owner + counsel: period, exceptions, proof of current choice, audit minimization |
| Application draft and submitted application | `APP-TEST-001` | Draft abandonment or application submission/withdrawal | Product + counsel: distinguish unsubmitted draft from any delivered employer copy; no delivered copy exists here |
| Job posting and order worksheet | `JOB-TEST-001`, `EMP-TEST-001` | Posting closure or executed order termination | Commercial + counsel: recordkeeping duty, moderation evidence, contract term; order is unsigned |
| Search/vector and model derivatives | No live sample vector | Source change, visibility off, deletion, model lifecycle | Search/AI owners: lineage, removal proof, provider deletion and cached-result behavior |
| Access and security events | `ALERT-TEST-001` authored scenario | Event closure or verified incident resolution | Security + counsel: evidentiary need, access limit, review/expiry |
| Privacy request case | `PRIV-TEST-001` | Verified request closure | Privacy + counsel: response proof and minimal retained audit record |
| Backups and exports | No manifest supplied | Backup rollover or export revocation | Platform owner: inventory, restore re-deletion, immutable storage constraints |

Decision rule: a reviewer must cite a current legal/contractual source or documented business need, identify jurisdiction and record class, approve a period and exception, and map physical deletion across the `vendor-data-inventory.md` systems. Until then, use `TBD`; do not execute an irreversible purge on the strength of this worksheet. The visibility-off event on 2026-09-20 is a future-discovery change, not a retention clock or deletion completion.
