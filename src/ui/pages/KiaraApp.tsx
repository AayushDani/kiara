'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { Binding, Notification, Provision, Role, Session, State } from '@/server/contracts';
import { compareClauses, errorMessage, humanize, processingStates, stateLabels, valueText } from '../presentation';
import DemoHarness from '../components/DemoHarness';

type View = 'activity' | 'policy' | 'context';
interface Workspace {
  state: State;
  session: Session;
  sources: Omit<Provision, 'text'>[];
  bindings: Binding[];
  readiness: {
    auth_mode?: string;
    worker_mode?: string;
    persistence: 'local' | 'mongodb';
    model: 'scripted' | 'openai';
    email: 'preview' | 'delivery';
    worker: boolean;
    limitations: string[];
  };
}
type IconName = 'arrow' | 'check' | 'document' | 'spark' | 'refresh' | 'chevron' | 'close' | 'mail' | 'shield' | 'activity' | 'building' | 'external';
function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const shapes: Record<IconName, ReactNode> = {
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    check: <path d="m5 12 4 4L19 6" />,
    document: <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" /><path d="M14 3v6h6M8 13h8M8 17h5" /></>,
    spark: <><path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4Z" /><path d="m20 2 .5 1.5L22 4l-1.5.5L20 6l-.5-1.5L18 4l1.5-.5Z" /></>,
    refresh: <><path d="M20 7a9 9 0 1 0 1 8M20 3v5h-5" /></>,
    chevron: <path d="m9 5 7 7-7 7" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 6 9 7 9-7" /></>,
    shield: <><path d="m12 3 8 3v5c0 5-4 8-8 10-4-2-8-5-8-10V6Z" /><path d="m8 12 3 3 5-6" /></>,
    activity: <path d="M2 12h4l3-8 6 16 3-8h4" />,
    building: <><path d="M4 21V7l8-4 8 4v14M2 21h20M9 21v-5h6v5M8 9h1m6 0h1M8 12h1m6 0h1" /></>,
    external: <><path d="M14 3h7v7m0-7L10 14" /><path d="M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{shapes[name]}</svg>;
}
function time(value: string) { return new Date(value).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' }); }
function Dialog({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') close();
      if (event.key !== 'Tab') return;
      const nodes = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input,select,textarea,[tabindex="0"]') ?? []);
      const first = nodes[0], last = nodes.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus(); };
  }, [close]);
  return <div className="demo-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}><div className="demo-modal" ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title}><div className="demo-card-head"><h2>{title}</h2><button className="demo-icon-button" onClick={close} aria-label="Close dialog"><Icon name="close" /></button></div><div className="demo-modal-body">{children}</div></div></div>;
}

export default function KiaraApp() {
  const [data, setData] = useState<Workspace | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<View>('activity');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [authRequired, setAuthRequired] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [customer, setCustomer] = useState('Taylor Morgan');
  const [residence, setResidence] = useState('US-CA');
  const [scenario, setScenario] = useState('covered');
  const [reviewNote, setReviewNote] = useState('');
  const [policyMode, setPolicyMode] = useState<'changes' | 'full'>('changes');
  const [source, setSource] = useState<Provision | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [email, setEmail] = useState<Notification | null>(null);
  const mounted = useRef(false);
  const changing = useRef(false);
  const refreshSequence = useRef(0);
  const appliedSequence = useRef(0);
  const lastReview = useRef('');
  const state = data?.state;
  const workflow = state?.workflows.find(item => item.workflow_id === selected) ?? state?.workflows.at(-1);
  const demoComplete = completed && !workflow;
  const role = data?.session.role ?? 'founder';
  const current = state?.revisions.find(item => item.revision_id === state.current_revision_id);
  const original = state?.revisions.find(item => item.revision_id === workflow?.base_revision_id) ?? current;
  const proposed = state?.revisions.find(item => item.revision_id === workflow?.candidate_revision_id);
  const processing = !!workflow && processingStates.has(workflow.state);
  const reviewable = !!workflow?.bundle_hash && (role === 'founder' ? workflow.state === 'awaiting_founder' : workflow.state === 'awaiting_lawyer');
  const isReview = workflow?.state === 'awaiting_founder' || workflow?.state === 'awaiting_lawyer';
  const terminal = !!workflow && ['finalized', 'closed_no_change', 'rejected', 'superseded', 'failed'].includes(workflow.state);
  const founderApproved = demoComplete || !!workflow?.approvals.some(approval => approval.role === 'founder' && approval.action === 'approved' && approval.bundle_hash === workflow.bundle_hash);
  const lawyerApproved = demoComplete || !!workflow?.approvals.some(approval => approval.role === 'lawyer' && approval.action === 'approved' && approval.bundle_hash === workflow.bundle_hash);

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    const response = await fetch('/api/workspace', { cache: 'no-store' });
    const payload = await response.json();
    if (response.status === 401) { if (mounted.current) setAuthRequired(true); throw new Error('Sign in to open this workspace.'); }
    if (!response.ok) throw new Error(errorMessage(payload, 'Could not load your demo. Try reconnecting.'));
    if (mounted.current && sequence >= appliedSequence.current) {
      appliedSequence.current = sequence;
      setAuthRequired(false);
      setData(previous => previous && previous.session.demo_id === payload.session.demo_id && (previous.state.reset_epoch > payload.state.reset_epoch || (previous.state.reset_epoch === payload.state.reset_epoch && previous.state.state_version > payload.state.state_version)) ? previous : payload);
    }
    return payload as Workspace;
  }, []);
  useEffect(() => {
    mounted.current = true;
    const workflowId = new URLSearchParams(window.location.search).get('workflow');
    if (workflowId) { setSelected(workflowId); setView('policy'); }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      let delay = 2500;
      try {
        if (!changing.current) {
          const next = await refresh();
          delay = next.state.workflows.some(item => processingStates.has(item.state)) ? 900 : 2500;
        }
      } catch (reason) { if (!stopped) setError(reason instanceof Error ? reason.message : 'Connection interrupted.'); }
      if (!stopped) timer = setTimeout(poll, delay);
    }
    void poll();
    return () => { mounted.current = false; stopped = true; clearTimeout(timer); };
  }, [refresh]);
  useEffect(() => {
    if (workflow && ['awaiting_founder', 'awaiting_lawyer'].includes(workflow.state)) {
      const reviewKey = `${workflow.workflow_id}:${workflow.state}`;
      if (lastReview.current !== reviewKey) { lastReview.current = reviewKey; setView('policy'); setReviewNote(''); }
    }
  }, [workflow]);
  const closeSource = useCallback(() => setSource(null), []);
  const closeEmail = useCallback(() => setEmail(null), []);

  async function post(path: string, body: unknown) {
    if (changing.current) return null;
    changing.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': data?.session.csrf ?? '', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) throw new Error(errorMessage(payload, 'The action could not be completed.'));
      try { await refresh(); } catch { setError('Your action was saved. Reconnect to see the latest workspace before continuing.'); }
      if (payload.demo_reset || path === '/api/reset') {
        setSelected(null); setView('activity'); setEmail(null); setSource(null); setReviewNote('');
        setCustomer('Taylor Morgan'); setResidence('US-CA'); setScenario('covered');
        setCompleted(payload.state === 'finalized');
        setNotice(payload.state === 'finalized' ? 'Both approvals are complete. Your original demo data has been restored.' : 'Demo reset. Your original data is ready for another run.');
        window.history.replaceState(null, '', '/');
      }
      return payload;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The action could not be completed.');
      try { await refresh(); } catch { /* Keep the actionable command error. */ }
      return null;
    } finally { changing.current = false; setBusy(false); }
  }
  async function startDemo(event?: FormEvent) {
    event?.preventDefault();
    if (!data || !customer.trim()) return;
    const california = residence === 'US-CA';
    const result = await post('/api/events', {
      customer_name: customer.trim(), residence, scenario,
      postal_address: { line1: '123 Example Avenue', city: california ? 'San Francisco' : 'New York', region: california ? 'CA' : 'NY', postal_code: california ? '94105' : '10001', country: 'US' },
      expected_reset_epoch: data.session.reset_epoch,
    });
    if (result) {
      setCompleted(false); setSelected(result.workflow_id); setView('activity');
      window.history.replaceState(null, '', `?workflow=${encodeURIComponent(result.workflow_id)}`);
    }
  }
  async function approve() {
    if (!data || !workflow || !reviewable) return;
    const actingRole = role;
    const result = await post(`/api/workflows/${workflow.workflow_id}/review`, {
      action: 'approved', note: reviewNote,
      expected_state_version: workflow.state_version,
      expected_reset_epoch: data.session.reset_epoch,
      bundle_hash: workflow.bundle_hash,
    });
    if (result && !result.demo_reset) { setReviewNote(''); setNotice(actingRole === 'founder' ? 'Founder approved. Switch to lawyer to review the same policy version.' : 'Both approvals saved. The policy is finalized internally.'); }
  }
  async function changeRole(next: Role) {
    if (next === role) return;
    const result = await post('/api/session', { role: next });
    if (result) { setReviewNote(''); setNotice(`You are now reviewing as the simulated ${next}.`); }
  }
  async function openSource(key: string) {
    setSourceLoading(true); setError('');
    try {
      const response = await fetch(`/api/sources/${encodeURIComponent(key)}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(errorMessage(payload, 'Source unavailable.'));
      setSource(payload);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Source unavailable.'); }
    finally { setSourceLoading(false); }
  }

  if (authRequired) return <Login onSignedIn={async () => { setError(''); await refresh(); }} />;
  if (!data || !state) return <main className="demo-loading"><div className="demo-brand-mark"><Icon name="spark" size={25} /></div><h1>Kiara</h1><p>{error || 'Preparing your private demo workspace…'}</p>{error && <button className="demo-primary" onClick={() => void refresh().catch(reason => setError(reason.message))}>Reconnect</button>}<span className="demo-loading-line" /></main>;

  const publicDemo = data.readiness.auth_mode === 'public_demo';
  const hosted = data.readiness.auth_mode === 'hosted_password';
  const events = state.events.filter(item => item.workflow_id === workflow?.workflow_id).slice().reverse();
  const notification = state.notifications.filter(item => item.workflow_id === workflow?.workflow_id).at(-1);
  const rows = compareClauses(original, proposed);
  const changedRows = rows.filter(row => row.change !== 'unchanged');
  const activeFacts = workflow?.facts ?? state.facts;
  const activeRevision = proposed ?? current;
  const reviewRole: Role = workflow?.state === 'awaiting_lawyer' ? 'lawyer' : 'founder';
  const canStart = !workflow || terminal;
  const title = demoComplete ? <>Both reviews complete.<br /><span>One clear decision.</span></> : !workflow ? <>A new customer.<br /><span>A new legal question.</span></> : workflow.state === 'awaiting_founder' ? <>A policy update.<br /><span>Your judgment, next.</span></> : workflow.state === 'awaiting_lawyer' ? <>Founder approved.<br /><span>Over to legal.</span></> : workflow.state === 'closed_no_change' ? <>Context checked.<br /><span>No update needed.</span></> : workflow.state === 'needs_information' ? <>A missing fact.<br /><span>A useful pause.</span></> : workflow.state === 'failed' || workflow.state === 'needs_human_review' ? <>A careful pause.<br /><span>A person takes over.</span></> : <>A new signal.<br /><span>Kiara connects the dots.</span></>;
  const description = demoComplete ? 'The full review is complete. Your demo has reset, ready for the next run.' : !workflow ? 'Simulate a signup. Watch company context become a source-backed policy update.' : isReview ? 'Review the proposed changes below. Each approval is tied to this exact version.' : workflow.state === 'needs_information' ? 'Kiara will not fill in unknown company facts. Reset to try the covered scenario.' : workflow.state === 'closed_no_change' ? 'The recorded company facts do not require a change for this assessed scope.' : 'The harness on the right shows every recorded step, check, and repair.';

  return <div className="demo-app">
    <header className="demo-header">
      <a className="demo-brand" href="/" aria-label="Kiara home"><span className="demo-brand-mark"><Icon name="spark" size={21} /></span><strong>kiara<span>.</span></strong></a>
      <span className="demo-tagline">Legal context, in motion.</span>
      <div className="demo-header-actions"><span className="demo-environment"><span />Interactive demo</span><label className="demo-role-switch"><span>{hosted ? 'Role' : 'Simulated role'}</span>{hosted ? <strong>{humanize(role)}</strong> : <select aria-label="Simulated role" value={role} disabled={busy} onChange={event => void changeRole(event.target.value as Role)}><option value="founder">Founder</option><option value="lawyer">Lawyer</option></select>}</label><button className="demo-reset" disabled={busy} onClick={() => void post('/api/reset', { expected_reset_epoch: data.session.reset_epoch })}><Icon name="refresh" size={15} />Reset demo</button></div>
    </header>
    <div className="demo-layout">
      <main className="demo-workspace">
        {error && <div className="demo-banner" data-tone="error" role="alert"><span>{error}</span><button className="demo-link" disabled={busy} onClick={() => void refresh().then(() => setError('')).catch(reason => setError(reason.message))}>Reconnect</button></div>}
        {notice && <div className="demo-banner" data-tone="success" role="status"><Icon name="check" size={17} /><span>{notice}</span><button className="demo-icon-button" onClick={() => setNotice('')} aria-label="Dismiss update"><Icon name="close" size={14} /></button></div>}
        <section className="demo-hero">
          <div className="demo-eyebrow"><span />THE COMPANY WORKSPACE <span className="demo-company-name">/ {state.company_name}</span></div>
          <h1>{title}</h1><p>{description}</p>
          {canStart && <form className="demo-start-form" onSubmit={event => void startDemo(event)}>
            <div className="demo-start-row"><button className="demo-primary" type="submit" disabled={busy || role !== 'founder' || !customer.trim()}><Icon name="spark" size={17} />{busy ? 'Starting your demo…' : demoComplete ? 'Run the demo again' : residence === 'US-CA' ? 'Simulate California signup' : 'Simulate New York signup'}<Icon name="arrow" size={17} /></button><span className="demo-start-caption">Fictional customer. Real workflow.</span></div>
            {role !== 'founder' && <button type="button" className="demo-link" disabled={busy} onClick={() => void changeRole('founder')}>Switch to founder to start <Icon name="arrow" size={14} /></button>}
            <details className="demo-scenario"><summary>Customize scenario <Icon name="chevron" size={12} /></summary><div className="demo-field-grid"><label className="demo-field">Fictional customer<input value={customer} onChange={event => setCustomer(event.target.value)} required maxLength={100} autoComplete="off" /></label><label className="demo-field">Declared legal residence<select value={residence} onChange={event => setResidence(event.target.value)}><option value="US-CA">California, US</option><option value="US-NY">New York, US</option></select></label><label className="demo-field demo-field-wide">Company scenario<select value={scenario} onChange={event => setScenario(event.target.value)}><option value="covered">Covered · $30M prior-year revenue</option><option value="unknown">Unknown · prior-year revenue missing</option><option value="not_covered">Not covered · assessed routes are false</option></select></label></div><p>A fictional postal address is supplied separately. Declared residence and explicit company facts determine the assessment.</p></details>
          </form>}
          {workflow && <div className="demo-signal"><span className="demo-signal-avatar">{workflow.customer_name.split(' ').map(word => word[0]).slice(0, 2).join('')}</span><div><strong>{workflow.customer_name}</strong><span>{workflow.residence === 'US-CA' ? 'California' : 'New York'} signup · fictional customer</span></div><span className="demo-status-pill" data-tone={processing ? 'active' : isReview ? 'review' : workflow.state === 'failed' || workflow.state === 'rejected' ? 'error' : terminal ? 'success' : 'warning'}>{processing && <span className="demo-pulse" />}{stateLabels[workflow.state]}</span></div>}
        </section>

        <ol className="demo-stage-progress" aria-label="Demo progress">
          {[{ label: 'Assess & prepare', done: !!workflow?.bundle_hash || demoComplete, active: processing || !workflow && !demoComplete }, { label: 'Founder review', done: founderApproved, active: workflow?.state === 'awaiting_founder' }, { label: 'Lawyer review', done: lawyerApproved, active: workflow?.state === 'awaiting_lawyer' }].map((step, index) => <li key={step.label} data-state={step.done ? 'complete' : step.active ? 'current' : 'pending'}><span>{step.done ? <Icon name="check" size={12} /> : String(index + 1).padStart(2, '0')}</span>{step.label}</li>)}
        </ol>

        <section className="demo-card demo-document-card" aria-label="Privacy policy status"><span className="demo-icon-box"><Icon name="document" size={23} /></span><div><h2>Privacy policy</h2><p>{proposed ? `Version ${proposed.revision_number} proposed · ${changedRows.length} changed sections` : `Version ${current?.revision_number ?? 1} · original company policy`}</p></div><button className="demo-link" onClick={() => setView('policy')}>{proposed ? 'Review changes' : 'View policy'}<Icon name="arrow" size={15} /></button></section>

        <nav className="demo-tabs" aria-label="Workspace views">{([{ id: 'activity', label: 'Activity', icon: 'activity' }, { id: 'policy', label: 'Policy', icon: 'document' }, { id: 'context', label: 'Company context', icon: 'building' }] as const).map(tab => <button key={tab.id} aria-selected={view === tab.id} onClick={() => setView(tab.id)}><Icon name={tab.icon} size={16} />{tab.label}{tab.id === 'policy' && proposed && <span className="demo-tab-count">{changedRows.length}</span>}</button>)}</nav>

        {view === 'activity' && <section className="demo-view" aria-label="Company activity">
          {!workflow ? <div className="demo-empty"><span className="demo-empty-symbol"><Icon name={demoComplete ? 'check' : 'activity'} size={25} /></span><h2>{demoComplete ? 'Ready for a fresh start.' : 'Your next event starts the story.'}</h2><p>{demoComplete ? 'Both ordered approvals passed. The policy, company facts, and harness are back at their original baseline.' : 'A California signup gives Kiara a signal to check the company facts, review the law, and prepare a policy update.'}</p><div className="demo-empty-flow"><span>Customer signal</span><Icon name="arrow" size={13} /><span>Legal context</span><Icon name="arrow" size={13} /><span>Human review</span></div></div> : <>
            {workflow.assessment && !['queued', 'waiting_for_document_slot', 'retrieving_context', 'assessing'].includes(workflow.state) && !(workflow.state === 'repairing' && !workflow.candidate_revision_id) && <div className="demo-assessment"><div className="demo-card-head"><h2>{workflow.assessment.outcome === 'covered' ? 'A policy update is supported.' : workflow.assessment.outcome === 'needs_information' ? 'More company information is needed.' : 'No change needed for this scope.'}</h2><Icon name="shield" size={20} /></div><p>{workflow.assessment.summary}</p><details className="demo-details"><summary>View assessment criteria</summary><ul className="demo-criteria">{workflow.assessment.criteria.map((criterion, index) => <li key={`${criterion.label}-${index}`} data-result={criterion.result}><strong>{criterion.result === 'pass' ? '✓' : criterion.result === 'unknown' ? '?' : '−'} {criterion.label}</strong><p>{criterion.evidence}</p></li>)}</ul></details></div>}
            <div className="demo-section-label">RECORDED ACTIVITY <span>{events.length} events</span></div>
            <ol className="demo-activity-list">{events.slice(0, 7).map(event => <li key={event.event_id}><span className="demo-activity-dot" data-tone={event.type.includes('failed') ? 'warning' : event.type.includes('approved') ? 'success' : ''} /><div><strong>{event.title}</strong><p>{event.detail}</p></div><time dateTime={event.created_at}>{time(event.created_at)}</time></li>)}</ol>
            {events.length > 7 && <details className="demo-details"><summary>{events.length - 7} earlier events</summary><ol className="demo-activity-list">{events.slice(7).map(event => <li key={event.event_id}><span className="demo-activity-dot" /><div><strong>{event.title}</strong><p>{event.detail}</p></div><time dateTime={event.created_at}>{time(event.created_at)}</time></li>)}</ol></details>}
            {isReview && <button className="demo-primary" onClick={() => setView('policy')}>Review the proposed policy<Icon name="arrow" size={16} /></button>}
            {processing && <details className="demo-details"><summary>Processing taking longer than expected?</summary><p>The workflow progresses in the background. Resume safely if the worker was interrupted.</p><button className="demo-secondary" disabled={busy} onClick={() => void post('/api/worker/resume', {})}>Resume processing</button></details>}
            {workflow.failure && <div className="demo-banner" data-tone="error">{workflow.failure}</div>}
          </>}
          {notification && <button className="demo-email-card" onClick={() => setEmail(notification)}><span className="demo-icon-box"><Icon name="mail" size={19} /></span><div><strong>{notification.mode === 'preview' ? 'Legal review email preview' : 'Legal review notification'}</strong><span>{notification.mode === 'preview' ? 'Saved preview · no email sent' : humanize(notification.status)}</span></div><Icon name="chevron" size={16} /></button>}
        </section>}

        {view === 'policy' && <section className="demo-view" aria-label="Privacy policy review">
          {isReview && <div className="demo-approval-card"><div className="demo-card-head"><div><span className="demo-eyebrow">HUMAN JUDGMENT REQUIRED</span><h2>{workflow.state === 'awaiting_founder' ? 'Ready for your founder review.' : 'The final decision belongs to legal.'}</h2></div><span className="demo-icon-box"><Icon name="shield" size={21} /></span></div><p>{workflow.state === 'awaiting_founder' ? 'Kiara has prepared and validated the proposal. Review the exact changes, then pass it to your lawyer.' : publicDemo ? 'Review the founder-approved packet. Your approval completes the demo and restores the original data.' : 'Review the founder-approved packet. Both decisions must approve this same policy version.'}</p><div className="demo-approval-roles"><div className="demo-approval-person" data-done={founderApproved}><span>{founderApproved ? <Icon name="check" size={15} /> : 'F'}</span><div><strong>Founder</strong><small>{founderApproved ? 'Approved this version' : 'Reviews first'}</small></div></div><Icon name="arrow" size={16} /><div className="demo-approval-person" data-done={lawyerApproved}><span>{lawyerApproved ? <Icon name="check" size={15} /> : 'L'}</span><div><strong>Lawyer</strong><small>{founderApproved ? 'Ready for review' : 'After founder approval'}</small></div></div></div>
            {reviewable ? <><details className="demo-details"><summary>Add a review note</summary><label className="demo-field"><span className="sr-only">Review note</span><textarea value={reviewNote} onChange={event => setReviewNote(event.target.value)} maxLength={5000} rows={3} placeholder="What should the next reviewer know?" /></label></details><button className="demo-primary" disabled={busy} onClick={() => void approve()}><Icon name="check" size={17} />{busy ? 'Saving approval…' : role === 'founder' ? 'Approve as founder' : publicDemo ? 'Approve & finish demo' : 'Approve as lawyer'}<Icon name="arrow" size={17} /></button></> : hosted ? <p className="demo-fine-print">Sign in as the {reviewRole} to continue this review.</p> : <button className="demo-primary" disabled={busy} onClick={() => void changeRole(reviewRole)}>Switch to {reviewRole} review<Icon name="arrow" size={17} /></button>}
            {notification && <button className="demo-link" onClick={() => setEmail(notification)}><Icon name="mail" size={14} />{notification.mode === 'preview' ? 'View email preview · not sent' : 'View notification'}</button>}
            <p className="demo-fine-print">Simulated roles · Internal approval only · No public policy is published</p>
          </div>}
          <div className="demo-policy-toolbar"><div><span className="demo-section-label">{proposed ? 'THE PROPOSED UPDATE' : 'THE CURRENT DOCUMENT'}</span><h2>Privacy policy <span>v{activeRevision?.revision_number}</span></h2></div>{proposed ? <div className="demo-segmented"><button aria-pressed={policyMode === 'changes'} onClick={() => setPolicyMode('changes')}>Changes</button><button aria-pressed={policyMode === 'full'} onClick={() => setPolicyMode('full')}>Full policy</button></div> : <span className="demo-status-pill">Baseline</span>}</div>
          {proposed && <p className="demo-policy-summary">{changedRows.length} sections updated or added. Source-backed, {workflow?.model_mode === 'scripted' ? 'scripted' : 'model-generated'} proposal. {workflow?.bundle_hash ? 'Validation passed; ready for human judgment.' : processing ? 'Validation is still in progress.' : 'Validation is paused; human attention is required.'}</p>}
          {!proposed && processing && <div className="demo-banner" data-tone="info">The proposed update will appear here after drafting. This is your original policy.</div>}
          {proposed && policyMode === 'changes' ? <div className="demo-policy-changes">{changedRows.map((row, index) => {
            const evidence = (proposed.evidence_bindings ?? data.bindings).filter(binding => binding.clause_ids.includes(row.id));
            const sourceKeys = [...new Set(evidence.flatMap(binding => binding.legal_refs.map(ref => ref.provision_key)))];
            return <article className="demo-clause" key={row.id}><div className="demo-clause-heading"><span>{String(index + 1).padStart(2, '0')}</span><h3>{row.proposed?.heading ?? row.original?.heading}</h3><span className="demo-status-pill" data-tone={row.change === 'added' ? 'success' : 'review'}>{humanize(row.change)}</span></div><div className="demo-clause-columns"><div className="demo-clause-before"><span>BEFORE · V{original?.revision_number}</span><p>{row.original?.body ?? 'This section is new.'}</p></div><div className="demo-clause-after"><span>PROPOSED · V{proposed.revision_number}</span><p>{row.proposed?.body ?? 'This section is removed.'}</p></div></div>{sourceKeys.length > 0 && <div className="demo-clause-sources"><span>Source evidence</span>{sourceKeys.map(key => <button key={key} className="demo-source-chip" disabled={sourceLoading} onClick={() => void openSource(key)}>{data.sources.find(item => item.provision_key === key)?.title ?? humanize(key)}<Icon name="external" size={11} /></button>)}</div>}</article>;
          })}</div> : <article className="demo-policy-document"><div className="demo-policy-document-heading"><Icon name="document" size={22} /><h3>{activeRevision?.title}</h3><span>Version {activeRevision?.revision_number} · {activeRevision?.policy_updated_on}</span></div>{activeRevision?.clauses.map(clause => <section key={clause.clause_id}><h3>{clause.heading}</h3><p>{clause.body}</p></section>)}</article>}
          {activeRevision && <a className="demo-link demo-download" href={`/api/documents/${activeRevision.revision_id}/export`} download>Download policy text<Icon name="arrow" size={14} /></a>}
        </section>}

        {view === 'context' && <section className="demo-view" aria-label="Company context"><div className="demo-context-intro"><span className="demo-eyebrow">CONTEXT BEFORE CONCLUSIONS</span><h2>A company is more than a signup.</h2><p>{workflow ? 'These are the company facts pinned to this workflow.' : 'These original company facts form the starting point for your demo.'} Unknown facts stay unknown.</p></div><div className="demo-context-grid">{activeFacts.map(fact => <article className="demo-fact" key={fact.fact_id}><div><h3>{humanize(fact.fact_key)}</h3><span className="demo-status-pill" data-tone={fact.knowledge === 'known' ? '' : 'warning'}>{humanize(fact.knowledge)}</span></div><pre>{valueText(fact.value)}</pre><p>{fact.provenance}</p></article>)}</div><details className="demo-details"><summary>Retained legal sources · {data.sources.length}</summary><div className="demo-source-list">{data.sources.map(item => <button key={item.provision_key} className="demo-link" disabled={sourceLoading} onClick={() => void openSource(item.provision_key)}>{item.title}<Icon name="external" size={14} /></button>)}</div></details></section>}
        <footer className="demo-footer"><span><Icon name="shield" size={13} />{publicDemo ? 'Your own isolated demo workspace' : 'Synthetic company workspace'}</span><span>{data.readiness.model === 'scripted' ? 'Scripted model' : 'Live model'} · {data.readiness.email === 'preview' ? 'Email previews' : 'Email delivery configured'}</span></footer>
      </main>
      <DemoHarness state={state} workflow={workflow} readiness={data.readiness} completed={demoComplete} />
    </div>
    <div className="sr-only" role="status" aria-live="polite">{workflow ? stateLabels[workflow.state] : demoComplete ? 'Demo complete. Original data restored.' : 'Ready to start the demo.'}</div>
    {source && <Dialog title="The source behind the change" close={closeSource}><span className="demo-status-pill">Retained legal source</span><h3>{source.title}</h3><p className="demo-fine-print">Retrieved {source.retrieved_at.slice(0, 10)} · Effective from {source.effective_from.slice(0, 10)}</p><blockquote className="demo-source-excerpt">{source.text}</blockquote><a className="demo-link" href={source.url} target="_blank" rel="noopener noreferrer">Open official source<Icon name="external" size={14} /></a><details className="demo-details"><summary>Evidence identifiers</summary><dl><dt>Provision</dt><dd><code>{source.provision_key}</code></dd><dt>Content hash</dt><dd><code>{source.content_hash}</code></dd></dl></details></Dialog>}
    {email && <Dialog title={email.mode === 'preview' ? 'Email preview · not sent' : 'Review notification'} close={closeEmail}><span className="demo-status-pill" data-tone="review">{email.mode === 'preview' ? 'Preview only' : humanize(email.status)}</span><dl className="demo-email-meta"><dt>To</dt><dd>{email.to}</dd><dt>Subject</dt><dd>{email.subject}</dd></dl><div className="demo-email-body">{email.body}</div><p className="demo-fine-print">{email.mode === 'preview' ? 'This preview was saved in your workspace. No real email was sent.' : 'Email delivery does not change the approval status.'}</p></Dialog>}
  </div>;
}

function Login({ onSignedIn }: { onSignedIn: () => Promise<void> }) {
  const [role, setRole] = useState<Role>('founder');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role, password }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(errorMessage(payload, 'Could not sign in.'));
      setPassword(''); await onSignedIn();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not sign in.'); }
    finally { setBusy(false); }
  }
  return <main className="demo-loading"><div className="demo-brand-mark"><Icon name="spark" size={23} /></div><h1>Sign in to Kiara</h1><form className="demo-login" onSubmit={event => void submit(event)}><label className="demo-field">Account<select value={role} onChange={event => setRole(event.target.value as Role)}><option value="founder">Founder</option><option value="lawyer">Lawyer</option></select></label><label className="demo-field">Password<input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required maxLength={256} /></label>{error && <p role="alert">{error}</p>}<button className="demo-primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button></form></main>;
}
