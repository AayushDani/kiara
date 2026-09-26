import type { State, Workflow } from '../server/contracts';

export type StepStatus = 'waiting' | 'active' | 'complete' | 'blocked' | 'skipped';
export interface HarnessStep { id: string; title: string; detail: string; status: StepStatus }

/** A projection of the current persisted generation, never a playback timer. */
export function harnessSteps(workflow?: Workflow, configuredModel: 'scripted' | 'openai' = 'scripted'): HarnessStep[] {
  const steps: HarnessStep[] = [
    { id: 'signal', title: 'Notice the change', detail: 'A synthetic signup starts the review.', status: 'waiting' },
    { id: 'context', title: 'Gather the context', detail: 'Company facts, current policy, and retained legal sources.', status: 'waiting' },
    { id: 'assessment', title: 'Check applicability', detail: 'Assess the explicit company facts against legal criteria.', status: 'waiting' },
    { id: 'draft', title: 'Prepare a policy update', detail: (workflow?.model_mode || configuredModel) === 'openai' ? 'AI-generated wording with clause-level evidence.' : 'Scripted wording with clause-level evidence.', status: 'waiting' },
    { id: 'validation', title: 'Validate & repair', detail: 'Check evidence and citations before human review.', status: 'waiting' },
    { id: 'approval', title: 'Put people in control', detail: 'Founder approval, then lawyer approval of the same packet.', status: 'waiting' },
  ];
  if (!workflow) return steps;
  const w = workflow;
  const stage: Record<Workflow['state'], number> = {
    queued: 1, waiting_for_document_slot: 1, retrieving_context: 1, assessing: 2,
    needs_information: 2, drafting: 3, validating: 4, repairing: w.candidate_revision_id ? 4 : 1,
    needs_human_review: w.bundle_hash ? 5 : w.candidate_revision_id ? 4 : 1, awaiting_founder: 5,
    awaiting_lawyer: 5, ready_to_finalize: 5, finalized: 5, closed_no_change: 2,
    rejected: 5, superseded: 0, failed: 0,
  };
  const current = stage[w.state];
  steps.forEach((step, i) => { step.status = i < current ? 'complete' : i === current ? 'active' : 'waiting'; });
  steps[0].detail = `${w.customer_name} · ${w.residence === 'US-CA' ? 'California' : w.residence === 'US-NY' ? 'New York' : w.residence} declared residence`;
  if (w.evidence_keys.length && current > 1) steps[1].detail = `${w.evidence_keys.length} retained legal provisions pinned with company facts.`;
  if (w.assessment && current >= 2) steps[2].detail = w.assessment.summary;
  if (w.candidate_revision_id && current >= 3) steps[3].detail = w.model_mode === 'scripted' ? 'A scripted draft is stored as a separate policy revision.' : 'A generated draft is stored as a separate policy revision.';
  if (current >= 4) {
    const checks = w.validations.filter(v => v.stage === 'proposal');
    steps[4].detail = `${checks.length} proposal checks · ${w.repair_count} recorded repairs${w.bundle_hash ? ' · review packet sealed' : ''}.`;
  }
  const founder = !!w.bundle_hash && w.approvals.some(a => a.role === 'founder' && a.action === 'approved' && a.bundle_hash === w.bundle_hash);
  const lawyer = !!w.bundle_hash && w.approvals.some(a => a.role === 'lawyer' && a.action === 'approved' && a.bundle_hash === w.bundle_hash);
  if (w.state === 'awaiting_founder') steps[5].detail = 'Paused for founder review. The policy has not changed.';
  if (w.state === 'awaiting_lawyer') steps[5].detail = founder ? 'Founder approved this packet. Waiting for lawyer review.' : 'Waiting for an ordered approval record.';
  if (w.state === 'finalized' && founder && lawyer) { steps[5].status = 'complete'; steps[5].detail = 'Both approvals recorded for this packet. Finalized internally.'; }
  if (['needs_information', 'needs_human_review', 'rejected', 'failed', 'superseded'].includes(w.state)) steps[current].status = 'blocked';
  if (w.state === 'repairing') steps[current].detail = w.candidate_revision_id ? 'A validation issue was caught. Repair and revalidation are in progress.' : 'Missing applicability evidence was caught. Retrieval is being repaired.';
  if (w.state === 'closed_no_change') {
    steps[2].status = 'complete';
    steps.slice(3).forEach(step => { step.status = 'skipped'; step.detail = 'Not needed for this assessed scope.'; });
  }
  if (w.failure) steps[current].detail = w.failure;
  return steps;
}

export function harnessSnapshot(state: State, workflow?: Workflow) {
  const harness = state.harnesses.find(h => h.version === (workflow?.harness_version ?? state.champion_version));
  return {
    harness_version: harness?.version ?? state.champion_version,
    prefetch_enabled: harness?.prefetch ?? false,
    workspace_generation: state.reset_epoch,
    workflow_state: workflow?.state ?? 'ready_for_signup',
    declared_residence: workflow?.residence ?? null,
    assessment: workflow?.assessment?.outcome ?? null,
    evidence_count: workflow?.evidence_keys.length ?? 0,
    repairs_recorded: workflow?.repair_count ?? 0,
    packet_sealed: !!workflow?.bundle_hash,
    approvals: workflow?.approvals.filter(a => a.action === 'approved' && a.bundle_hash === workflow.bundle_hash).map(a => a.role) ?? [],
  };
}
