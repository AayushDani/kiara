import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { Revision } from '../../src/server/contracts';
import { compareClauses, errorMessage, valueText } from '../../src/ui/presentation';

const baseline = JSON.parse(readFileSync('kiara-architecture/fixtures/documents/baseline.json', 'utf8')) as Revision;
const candidate = JSON.parse(readFileSync('kiara-architecture/fixtures/documents/candidate.json', 'utf8')) as Revision;

test('redline comparison retains every original and proposed clause with exact full text', () => {
  const rows = compareClauses(baseline, candidate);
  assert.equal(rows.length, new Set([...baseline.clauses, ...candidate.clauses].map(c => c.clause_id)).size);
  for (const clause of baseline.clauses) assert.deepEqual(rows.find(r => r.id === clause.clause_id)?.original, clause);
  for (const clause of candidate.clauses) assert.deepEqual(rows.find(r => r.id === clause.clause_id)?.proposed, clause);
  assert.ok(rows.some(r => r.change === 'added' || r.change === 'changed'));
  assert.ok(rows.some(r => r.change === 'unchanged'));
});

test('removals and heading-only edits cannot disappear from the redline', () => {
  const before = {clauses:[{clause_id:'a',heading:'First',body:'Keep exact text.'},{clause_id:'b',heading:'Second',body:'This gets removed.'}]} as Revision;
  const after = {clauses:[{clause_id:'a',heading:'Renamed',body:'Keep exact text.'},{clause_id:'c',heading:'Third',body:'New text.'}]} as Revision;
  const rows = compareClauses(before, after);
  assert.equal(rows.find(r => r.id === 'a')?.change, 'changed');
  assert.equal(rows.find(r => r.id === 'b')?.change, 'removed');
  assert.equal(rows.find(r => r.id === 'c')?.change, 'added');
  assert.equal(rows.find(r => r.id === 'b')?.original?.body, 'This gets removed.');
});

test('empty and missing revisions remain honest instead of inventing policy text', () => {
  assert.deepEqual(compareClauses(), []);
  assert.ok(compareClauses(undefined, candidate).every(r => r.change === 'added'));
  assert.ok(compareClauses(baseline, undefined).every(r => r.change === 'removed'));
});

test('unknown facts stay distinct from false and zero', () => {
  assert.equal(valueText(null), 'Not established');
  assert.equal(valueText(undefined), 'Not established');
  assert.equal(valueText(false), 'No');
  assert.equal(valueText(0), '0');
  assert.equal(valueText(true), 'Yes');
  assert.equal(valueText(30000000), '30,000,000');
});

test('client surfaces actionable structured API errors without coercing objects', () => {
  assert.equal(errorMessage({error:{code:'BUNDLE_CHANGED',message:'Review the current packet.'}}, 'Failed'), 'Review the current packet.');
  assert.equal(errorMessage({error:'Conflict'}, 'Failed'), 'Conflict');
  assert.equal(errorMessage({message:'Refresh required'}, 'Failed'), 'Refresh required');
  assert.equal(errorMessage({error:{private:'not surfaced'}}, 'Failed'), 'Failed');
  assert.equal(errorMessage(null, 'Failed'), 'Failed');
});
