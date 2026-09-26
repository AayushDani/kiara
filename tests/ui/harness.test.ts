import assert from 'node:assert/strict';
import test from 'node:test';
import type { Approval, State, Workflow } from '../../src/server/contracts';
import { seed } from '../../src/data/fixtures';
import { harnessSnapshot, harnessSteps } from '../../src/ui/demo-harness';

const timestamp = '2026-09-26T18:00:00.000Z';
function workflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    workflow_id: 'workflow-current', tenant_id: 'tenant', reset_epoch: 1, state: 'queued', state_version: 1,
    created_at: timestamp, updated_at: timestamp, customer_name: 'Taylor Morgan', residence: 'US-CA',
    scenario: 'covered', event_id: 'signup-event', base_revision_id: 'baseline', candidate_revision_id: null,
    harness_version: 1, context_epoch: 1, facts: [], assessment: null, validations: [], repair_count: 0,
    missing_bundle_repairs: 0, approvals: [], bundle_hash: null, review_input_hash: null,
    freshness_valid_until: '2026-09-27T18:00:00.000Z', model_mode: 'scripted', model_status: 'not_started',
    model_attempts: 0, input_tokens: 0, output_tokens: 0, reserved_cost: 0, cost_usd: 0,
    unknown_charge: false, lease_owner: null, lease_epoch: 0, lease_until: null, failure: null,
    evidence_keys: [], citation_offset: null, ...overrides,
  };
}
function approval(role: Approval['role'], bundle = 'current-packet'): Approval {
  return { approval_id: `${role}-${bundle}`, role, action: 'approved', actor_id: role, bundle_hash: bundle, created_at: timestamp, note: 'Synthetic approval' };
}
function step(w: Workflow, id: string) { return harnessSteps(w).find(item => item.id === id)!; }

test('empty and reset workspaces do not invent execution or approval activity', () => {
  assert.ok(harnessSteps().every(item => item.status === 'waiting'));
  const snapshot = harnessSnapshot(seed(2));
  assert.equal(snapshot.workspace_generation, 2);
  assert.equal(snapshot.workflow_state, 'ready_for_signup');
  assert.equal(snapshot.assessment, null);
  assert.equal(snapshot.evidence_count, 0);
  assert.equal(snapshot.packet_sealed, false);
  assert.deepEqual(snapshot.approvals, []);
});

test('stage progression follows saved workflow state rather than elapsed time', () => {
  const cases: Array<[Workflow['state'], string, string[]]> = [
    ['queued', 'context', ['signal']],
    ['retrieving_context', 'context', ['signal']],
    ['assessing', 'assessment', ['signal', 'context']],
    ['drafting', 'draft', ['signal', 'context', 'assessment']],
    ['validating', 'validation', ['signal', 'context', 'assessment', 'draft']],
    ['awaiting_founder', 'approval', ['signal', 'context', 'assessment', 'draft', 'validation']],
  ];
  for (const [state, current, completed] of cases) {
    const steps = harnessSteps(workflow({ state }));
    assert.deepEqual(steps.filter(item => item.status === 'active').map(item => item.id), [current], state);
    assert.deepEqual(steps.filter(item => item.status === 'complete').map(item => item.id), completed, state);
  }
});

test('fact correction restarts progress despite retained historical assessment, checks, and approvals', () => {
  const corrected = workflow({
    state: 'queued', context_epoch: 2, candidate_revision_id: null, bundle_hash: null,
    assessment: { outcome: 'covered', summary: 'Historical assessment must not appear current.', missing_facts: [], basis: [], criteria: [] },
    validations: [{ validation_id: 'old-validation', created_at: timestamp, stage: 'proposal', passed: true, codes: [], explanation: 'Old draft passed.', repaired: false }],
    evidence_keys: ['old-evidence'], approvals: [approval('founder', 'old-packet'), approval('lawyer', 'old-packet')],
  });
  assert.equal(step(corrected, 'context').status, 'active');
  for (const id of ['assessment', 'draft', 'validation', 'approval']) assert.equal(step(corrected, id).status, 'waiting');
  assert.notEqual(step(corrected, 'assessment').detail, corrected.assessment!.summary);
  assert.deepEqual(harnessSnapshot(seed(), corrected).approvals, []);
});

test('retrieval repairs and proposal repairs stay attached to the checkpoint that failed', () => {
  const retrieval = workflow({ state: 'repairing', candidate_revision_id: null });
  assert.equal(step(retrieval, 'context').status, 'active');
  assert.equal(step(retrieval, 'validation').status, 'waiting');
  const proposal = workflow({ state: 'repairing', candidate_revision_id: 'draft' });
  assert.equal(step(proposal, 'validation').status, 'active');
  assert.equal(step(proposal, 'approval').status, 'waiting');
});

test('non-citation validation failures are not described as citation repairs', () => {
  const w = workflow({ state: 'repairing', candidate_revision_id: 'edited-draft', validations: [{
    validation_id: 'contradiction', created_at: timestamp, stage: 'proposal', passed: false,
    codes: ['FACT_CONTRADICTION'], explanation: 'Draft contradicts the verified company facts.', repaired: false,
  }] });
  assert.doesNotMatch(step(w, 'validation').detail, /citation issue/i);
});

test('only approvals for the current sealed packet can complete the human checkpoint', () => {
  const w = workflow({ state: 'awaiting_lawyer', candidate_revision_id: 'draft', bundle_hash: 'current-packet', approvals: [approval('founder', 'old-packet')] });
  assert.doesNotMatch(step(w, 'approval').detail, /founder approved/i);
  assert.deepEqual(harnessSnapshot(seed(), w).approvals, []);
  w.approvals.push(approval('founder'));
  assert.match(step(w, 'approval').detail, /founder approved/i);
  assert.equal(step(w, 'approval').status, 'active');
  w.state = 'finalized';
  w.approvals.push(approval('lawyer', 'old-packet'));
  assert.notEqual(step(w, 'approval').status, 'complete');
  w.approvals.push(approval('lawyer'));
  assert.equal(step(w, 'approval').status, 'complete');
  assert.deepEqual(harnessSnapshot(seed(), w).approvals, ['founder', 'lawyer']);
});

test('no-change decisions skip drafting and approvals instead of fabricating successful reviews', () => {
  const w = workflow({ state: 'closed_no_change', assessment: { outcome: 'not_covered', summary: 'No policy change for this scope.', missing_facts: [], basis: [], criteria: [] } });
  assert.equal(step(w, 'assessment').status, 'complete');
  for (const id of ['draft', 'validation', 'approval']) assert.equal(step(w, id).status, 'skipped');
  assert.deepEqual(harnessSnapshot(seed(), w).approvals, []);
});

test('information and failed-check pauses block the relevant checkpoint', () => {
  assert.equal(step(workflow({ state: 'needs_information' }), 'assessment').status, 'blocked');
  assert.equal(step(workflow({ state: 'needs_human_review' }), 'context').status, 'blocked');
  assert.equal(step(workflow({ state: 'needs_human_review', candidate_revision_id: 'draft' }), 'validation').status, 'blocked');
  const failed = workflow({ state: 'failed', failure: 'Worker could not save its result.' });
  const blocked = harnessSteps(failed).filter(item => item.status === 'blocked');
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].detail, failed.failure);
  assert.equal(step(failed, 'approval').status, 'waiting');
});

test('requested changes to a sealed packet pause human review without inventing a validation failure', () => {
  const w = workflow({ state: 'needs_human_review', candidate_revision_id: 'draft', bundle_hash: 'current-packet', approvals: [{ ...approval('founder'), action: 'requested_changes' }] });
  assert.equal(step(w, 'validation').status, 'complete');
  assert.equal(step(w, 'approval').status, 'blocked');
});

test('snapshot identifies the harness pinned to the run even after champion promotion', () => {
  const state: State = seed();
  state.champion_version = 2;
  state.harnesses.push({ version: 2, harness_id: 'new-champion', prefetch: true, created_at: timestamp, status: 'active', reason: 'Test promotion' });
  const running = harnessSnapshot(state, workflow({ harness_version: 1 }));
  assert.equal(running.harness_version, 1);
  assert.equal(running.prefetch_enabled, false);
  assert.equal(harnessSnapshot(state).harness_version, 2);
  assert.equal(harnessSnapshot(state).prefetch_enabled, true);
});
