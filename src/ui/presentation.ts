import type { Clause, Revision, WorkflowState } from '../server/contracts';

export const stateLabels: Record<WorkflowState, string> = {
  queued: 'Queued', waiting_for_document_slot: 'Waiting for earlier review', retrieving_context: 'Retrieving context',
  assessing: 'Assessing applicability', needs_information: 'More information needed', drafting: 'Drafting policy',
  validating: 'Validating proposal', repairing: 'Repairing an issue', needs_human_review: 'Human review needed',
  awaiting_founder: 'Founder review', awaiting_lawyer: 'Lawyer review', ready_to_finalize: 'Finalizing',
  finalized: 'Finalized internally', closed_no_change: 'No change needed', rejected: 'Proposal rejected',
  superseded: 'Replaced by newer review', failed: 'Workflow stopped',
};
export const processingStates = new Set<WorkflowState>(['queued', 'waiting_for_document_slot', 'retrieving_context', 'assessing', 'drafting', 'validating', 'repairing', 'ready_to_finalize']);
export function humanize(value: string): string { return value.replaceAll('_', ' ').replace(/^./, c => c.toUpperCase()); }
export function valueText(value: unknown): string {
  if (value === null || value === undefined) return 'Not established';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return value.toLocaleString('en-US');
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}
export interface ClauseComparison { id: string; original?: Clause; proposed?: Clause; change: 'added' | 'removed' | 'changed' | 'unchanged' }
export function compareClauses(original?: Revision, proposed?: Revision): ClauseComparison[] {
  const before = new Map(original?.clauses.map(c => [c.clause_id, c]) ?? []);
  const after = new Map(proposed?.clauses.map(c => [c.clause_id, c]) ?? []);
  const ids = [...new Set([...(proposed?.clauses.map(c => c.clause_id) ?? []), ...(original?.clauses.map(c => c.clause_id) ?? [])])];
  return ids.map(id => ({ id, original: before.get(id), proposed: after.get(id), change: !before.has(id) ? 'added' : !after.has(id) ? 'removed' : before.get(id)!.body !== after.get(id)!.body || before.get(id)!.heading !== after.get(id)!.heading ? 'changed' : 'unchanged' }));
}
export function errorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback;
  const p = payload as { error?: unknown; message?: unknown };
  if (typeof p.error === 'object' && p.error !== null && 'message' in p.error && typeof p.error.message === 'string') return p.error.message;
  if (typeof p.message === 'string') return p.message;
  return typeof p.error === 'string' ? p.error : fallback;
}
