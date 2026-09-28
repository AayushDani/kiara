# Selected GovInfo and Atlas intake qualification — 28 September 2026

The content owner supplied a private GovInfo API key. The key was read from the macOS clipboard for this bounded check and is absent from this record, command output and Git. The selected source was `USCODE-2024-title17/USCODE-2024-title17-chap1-sec105`, under the exact official HTML URL `https://www.govinfo.gov/content/pkg/USCODE-2024-title17/html/USCODE-2024-title17-chap1-sec105.htm`.

`scripts/v2-govinfo-atlas-qualify.ts --preflight` connected to the inspected Atlas cluster with `MONGODB_DB=kiara_v2`; it reported `atlasReachable=true`, `privateKeyPresent=true`, zero provider calls and zero writes. The subsequent `--run` used the private key to inspect real GovInfo metadata, previewed and staged that exact source in a generated synthetic Atlas database, and checked the retained original:

| Check | Observed result |
| --- | --- |
| Exact selection and preview binding | Passed; package and granule IDs matched the requested section. |
| Retained original | 18,316 bytes, SHA-256 `be9a8a2918c3f674506e80087565ce9f5479ea358394313daf02e3aa0a1491ba`; encrypted Mongo original readback matched. |
| Source/authority state | Source authority remained unknown; no effective date or verified-at timestamp. |
| Answer coverage/index | Zero coverage entries and zero search chunks. |
| Cleanup | Generated database `kiara_legal_8c62374f7d814772bf372904581b493a` was dropped; collection-list verification passed. |

The check exited zero. It used the local bounded operator and an isolated generated Atlas database. The hosted OIDC route, qualified human legal review, current-law applicability, rights, and ongoing change monitoring were not established. This source is not approved for legal answers.
