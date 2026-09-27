# Linking authenticated provider events to work

Target: v2 §15 J04 and §16 event arrival. Signed GitHub, Slack and Drive intake retains the provider installation, object/revision identity, received/effective times, source audience and outbox record. Intake does not guess which matter a new event belongs to. An owner reviews the exact current event in Work → Evidence and records `event.link_matter` against an inspected source and matter version.

The link requires the named business owner, an authenticated retained provider event, current source revision, current installation access, exact matter audience and an open v2 matter. A source cannot be linked to two matters. The linked source remains provider evidence, never a deployment fact. The service appends an attributed conversation update with a citation to the same matter, queues its work, and retains a separate immutable activity event. Duplicate webhook delivery cannot create another source or link.

The synthetic provider-path regression signs a GitHub PR webhook and a Slack message webhook, ingests both without a guessed matter, links both through exact owner review and verifies one matter, two inline updates and zero promoted facts. Live provider installations and production customer correlation remain separate deployment qualifications.
