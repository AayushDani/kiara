# Test · business and data-flow context

Status: synthetic Test pilot declaration; not a verified real-world operation. Owner role: Test business owner. Version: 1, 2026-09-28.

## Products and users

Test is a US technology hiring marketplace. `Test Jobs` lets candidates browse and apply for technology roles. `Test Recruiter` lets verified employer customers post roles, search profiles where the candidate has chosen employer visibility, and send recruiting messages. `Test Match` suggests roles and profiles from skills, work preferences, and job criteria. Test Match is advisory; no automatic rejection, hiring decision, or background report is part of the pilot.

## Business parties

- Candidate: individual seeking work. May maintain a profile, choose visibility, save jobs, and apply. Candidate account and application are distinct records.
- Employer customer: organization that signs an order for Recruiter access and controls its own hiring decisions. A customer may have multiple authorized recruiter users.
- Test: marketplace operator, publisher of its own candidate notice and platform terms, processor/service provider for some employer-controlled application data depending on the specific flow and signed agreement. The exact role must be confirmed per flow.
- Providers: cloud hosting, email delivery, analytics, and AI model services are **vendor categories**, not named/installed vendors in this seed. Their actual identity, data use, regions, retention, and contracts remain to be inspected.

## Declared pilot flows

1. Candidate registers with an invented test identifier, skills, preferences, and optional resume-like synthetic text. Profile visibility defaults to private in this pilot design until the candidate chooses to make it visible to eligible employers.
2. Candidate applies to a listed role. The employer receives only the application fields for that application through the platform. Any external transmission requires a real configured integration and separately authorized test.
3. Employer user creates a job posting. Test moderates role relevance and obvious fraud. Employer owns job content and hiring criteria.
4. Test Match produces suggestions with a human review path, provenance of inputs, candidate correction route, and accommodation path. It does not score protected traits or auto-reject. Production behavior, bias testing, and NYC AEDT applicability remain unverified.
5. Privacy requests are logged, identity-verified, routed across profile, application, message, index, provider, and backup stores, and responded to under a reviewed jurisdictional policy. No retention period is represented as approved yet.

## Initial source inventory for Kiara

Candidate profile; visibility choice; job posting; application; recruiter message; matching output; account/access log; support/privacy request; employer order; provider contract; security incident record. The first nine are sample source **types**, not actual connected records. No live candidate data, job feed, employer account, or vendor installation is supplied by this pack.

## Questions that must remain open

Exact legal entity, headquarters and registration; actual product deployment and vendor list; controller/processor allocation by flow; regions and cross-border transfers; pricing/order terms; retention schedule and legal holds; AI model inputs/training; background screening; whether any automated tool substantially assists hiring decisions in NYC. A fact owner must replace the pilot declarations with evidence before using them for a real customer.
