# Legal-source scope for the Preview release

Date: 28 September 2026. This is a source-selection plan, not a legal opinion or a declaration of coverage.

Kiara's legal registry separates discovery, retained source text, a qualified review of applicability, and current coverage. The available GovInfo, eCFR, and Federal Register adapters address United States federal material. A question about state privacy law, a contract, or case law must not be answered as if those feeds covered it. The company document and policy record is also distinct from public law.

| Need | Candidate source | Permitted Preview role | Production condition |
|---|---|---|---|
| Federal statutes, regulations, notices and rule changes | [GovInfo](https://www.govinfo.gov/developers), [eCFR](https://www.ecfr.gov/developers/documentation/api/v1), [Federal Register](https://www.federalregister.gov/developers/documentation/api/v1) | Bounded official discovery; reviewed exact publication only after source and applicability checks | Named qualified reviewer, declared federal domain, effective-date and freshness policy |
| California consumer privacy | [California Privacy Protection Agency laws and regulations](https://cppa.ca.gov/regulations/) | Candidate official source for a California-specific review; not part of current coverage | Review exact operative statute and regulations, scope, effective dates, changes and applicability |
| State bills and legislative change signals | [Plural Open / Open States API v3](https://docs.openstates.org/api-v3/) | Nonofficial discovery of state legislative activity; its API requires a key | Check enactment and operative text against the official state publisher before any authority or deadline claim |
| Judicial opinions and citation checks | [Free Law Project CourtListener REST API v4](https://wiki.free.law/c/courtlistener/help/api/rest/v4/rest-api-v47) | Nonofficial case-law discovery and citation verification, separate from statutes and regulations | Jurisdiction and precedential-status review; production API use and volume must follow the provider's [terms and access rules](https://wiki.free.law/c/terms/courtlistener/courtlistenercom-terms-of-service-and-policies) |
| Company obligations and practice | User-authorized contracts, policies and confirmed facts | Scoped company evidence; no source becomes public law | Verify signed authority, revision, access, provenance and contradictory practice |

The next legal-content decision is a narrow initial jurisdiction and workflow with a named qualified reviewer. That reviewer should select the exact source set, resolve conflicts and effective dates, approve any interpretation, and own a check interval. Until then the UI must state that coverage is unestablished and route material legal conclusions to an owned review task. API availability or an AI-generated summary cannot substitute for those decisions.

The current legal-source monitor reads bounded HTML, plain text and XML. A selected publisher that offers only PDF requires a separately verified text rendition or a reviewed extraction path before Kiara can monitor its operative text. A link to a PDF alone does not establish that its contents were ingested or kept current.
