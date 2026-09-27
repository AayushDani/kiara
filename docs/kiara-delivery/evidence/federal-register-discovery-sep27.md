# Federal Register CFR-part discovery, 27 September 2026

## Connected public sample

Command: `node --import tsx scripts/v2-federal-register-discovery.ts --title 16 --part 1235`

The exact public API request returned `count: 3` and three first-page results for 16 CFR part 1235. The reader emitted `unreviewed_discovery`, `returnedCount: 3`, `moreResults: false` and official GovInfo PDF links for Federal Register documents `2022-08804` (Rule), `2018-13556` (Rule) and `2016-22557` (Proposed Rule). The result was read only. No API key, tenant session, Mongo write, counsel review or current-law conclusion was involved.

The [Federal Register API documentation](https://www.federalregister.gov/developers/documentation/api/v1) says public endpoints need no key and warns that the web rendition is not the official legal edition. The GovInfo PDF links are leads for official-source inspection, not proof that any rule currently applies to a particular customer.

## Local verification

The focused injected-response tests passed **3/3**; the assembled local suite passed **634/634**. They cover exact title/part parameters, first-page bounds, unreviewed status, official-link validation, malformed metadata and bounded response handling. TypeScript `tsc --noEmit --incremental false` passed. Those tests do not stand in for additional connected selections, source-rights review or qualified legal adjudication.
