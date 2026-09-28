# Official eCFR title-catalog read · 27 September 2026

`node --import tsx scripts/v2-ecfr-currentness.ts --title 16` made one read-only GET to the [official eCFR API catalog](https://www.ecfr.gov/api/versioner/v1/titles.json). No account key, tenant data, source staging or embedding was involved. The bounded reader returned:

```json
{"title":16,"name":"Commercial Practices","latestAmendedOn":"2026-09-24","latestIssueDate":"2026-09-24","upToDateAsOf":"2026-09-24","catalogDate":"2026-09-24","importInProgress":false,"sourceUrl":"https://www.ecfr.gov/api/versioner/v1/titles.json","status":"unreviewed_discovery"}
```

This is title-level catalog metadata, not a section-level change determination or a legal-source review. The [eCFR API documentation](https://www.ecfr.gov/developers/documentation/api/v1) identifies the government endpoint. [OFR's legal-status guidance](https://www.ecfr.gov/reader-aids/understanding-the-ecfr/what-is-the-ecfr) says the eCFR is an informational editorial compilation and directs legal researchers to verify against the current official CFR, daily Federal Register and LSA. Kiara does not stage this metadata as a legal authority, promote it to coverage, or infer applicability from it. No rate or uptime commitment was established by this one request.
