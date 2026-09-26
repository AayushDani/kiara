'use client';

import { useState } from 'react';
import type { State, Workflow } from '../../server/contracts';
import { harnessSnapshot, harnessSteps } from '../demo-harness';
import { processingStates, stateLabels } from '../presentation';

interface Props {
  state: State;
  workflow?: Workflow;
  readiness: { persistence: 'local' | 'mongodb'; model: 'scripted' | 'openai'; email: 'preview' | 'delivery'; worker?: boolean; worker_mode?: string };
  completed: boolean;
}

export default function DemoHarness({ state, workflow, readiness, completed }: Props) {
  const [view, setView] = useState<'execution' | 'snapshot'>('execution');
  const steps = harnessSteps(workflow);
  const events = state.events.filter(e => workflow && e.workflow_id === workflow.workflow_id);
  const running = !!workflow && processingStates.has(workflow.state);
  const snapshot = JSON.stringify(harnessSnapshot(state, workflow), null, 2).split('\n');
  return <aside className="harness-panel" aria-label="Execution harness">
    <header className="harness-header">
      <div className="harness-eyebrow"><span className="harness-braces" aria-hidden="true">{'{ }'}</span> THE HARNESS <span className="harness-version">v{workflow?.harness_version ?? state.champion_version}</span></div>
      <h2>See the thinking.<br/><span>Trust the checkpoints.</span></h2>
      <p>Every step below follows your saved workspace.</p>
    </header>
    <div className="harness-toolbar">
      <div className="harness-tabs" role="group" aria-label="Harness view">
        <button aria-pressed={view === 'execution'} onClick={() => setView('execution')}>Execution</button>
        <button aria-pressed={view === 'snapshot'} onClick={() => setView('snapshot')}>State snapshot</button>
      </div>
      <span className={`harness-status ${running ? 'running' : ''}`} role="status"><i/>{workflow ? running ? 'Processing' : 'Saved' : 'Ready'}</span>
    </div>
    <div className="harness-body">
      {completed && <div className="harness-reset-receipt"><strong>Previous run completed</strong><p>The server confirmed both approvals and restored the original data. This is the fresh workspace.</p></div>}
      {view === 'execution' ? <>
        <ol className="harness-steps">{steps.map((step, index) => <li className={`harness-step ${step.status}`} key={step.id}>
          <span className="harness-step-marker" aria-label={step.status}>{step.status === 'complete' ? '✓' : step.status === 'blocked' ? '!' : String(index + 1).padStart(2, '0')}</span>
          <div><div className="harness-step-title"><h3>{step.title}</h3>{step.status === 'active' && <span>{running ? 'IN PROGRESS' : 'YOUR TURN'}</span>}</div><p>{step.detail}</p></div>
        </li>)}</ol>
        {!!events.length && <details className="harness-events"><summary>Recorded events <span>{events.length}</span></summary><ol>{events.map(event => <li key={event.event_id}><time>{new Date(event.created_at).toLocaleTimeString('en-US', { hour12: false })}</time><div><strong>{event.title}</strong><p>{event.detail}</p></div></li>)}</ol></details>}
        {!workflow && <div className="harness-ready-note"><span aria-hidden="true">↳</span><p>Start with a signup on the left.<br/><strong>Watch the context become a review.</strong></p></div>}
      </> : <div className="harness-code"><div className="harness-code-label">workspace.snapshot.json <span>READ ONLY</span></div><pre aria-label="Saved workspace state">{snapshot.map((line, index) => <div className="harness-code-line" key={index}><span className="harness-line-number" aria-hidden="true">{index + 1}</span><code>{line.split(/("[^"\n]*"|\btrue\b|\bfalse\b|\bnull\b|\b\d+\b)/).map((token, t) => <span key={t} className={token.startsWith('"') ? line.indexOf(token) < line.indexOf(':') ? 'harness-token-key' : 'harness-token-string' : /^(true|false|null|\d+)$/.test(token) ? 'harness-token-value' : undefined}>{token}</span>)}</code></div>)}</pre><p>Derived from persisted state. This view does not edit or upgrade the harness.</p></div>}
      {workflow && <div className="harness-current-state"><span>CURRENT STATE</span><strong>{stateLabels[workflow.state]}</strong>{workflow.bundle_hash && <code title={workflow.bundle_hash}>packet {workflow.bundle_hash.slice(0, 12)}</code>}</div>}
    </div>
    <footer className="harness-footer"><div><span className="harness-storage-dot"/>{readiness.persistence === 'mongodb' ? 'MongoDB Atlas' : 'Local workspace'}<span>·</span>{readiness.worker_mode === 'vercel_workflow' ? 'Vercel Workflow' : 'Local worker'}</div><p>{readiness.model === 'scripted' ? 'Scripted model' : 'Live model'} · {readiness.email === 'preview' ? 'Email previews only' : 'Email delivery mode'} · Retained legal fixtures</p></footer>
  </aside>;
}
