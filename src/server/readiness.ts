import type {State} from './contracts';
import {persistenceMode} from '../data/store';
import {runtimeConfigurationStatus} from '../runtime/config';
import {operationalEvidence} from './operations';

export function readiness(s:State){
  const model=process.env.KIARA_MODEL_MODE==='openai'?'openai':'scripted',email=process.env.KIARA_EMAIL_MODE==='delivery'?'delivery':'preview';
  const provider=runtimeConfigurationStatus(),evidence=operationalEvidence(s).inference_evidence,limitations:string[]=[];
  if(persistenceMode()==='local')limitations.push('Local JSON persistence; MongoDB Atlas is not connected.');
  if(model==='scripted')limitations.push('Scripted demonstration: no live generation is claimed.');
  else if(!provider.ready)limitations.push(`OpenAI execution blocked: ${provider.blockers.join(', ')}.`);
  if(!evidence.completed_requests)limitations.push('No completed provider response is recorded in this workspace. Configuration is not inference evidence.');
  if(email==='preview')limitations.push('Email previews only; no messages are sent.');
  else if(process.env.KIARA_ALLOW_LIVE_EMAIL!=='true')limitations.push('Live email is disabled until explicitly authorized and configured.');
  limitations.push('Supported assessment scope: retained California CCPA provisions through 2026. Other jurisdictions and unsupported legal scope require human review.');
  limitations.push(process.env.KIARA_AUTH_MODE==='public_demo'?'Isolated public demonstration: both review roles and source freshness are simulated. Paid runs retain their audit and learning history. Access is tied to this visitor session.':process.env.KIARA_AUTH_MODE==='hosted_password'?'Separate password-protected founder and lawyer roles; professional identity is not independently verified.':'Localhost demonstration: reviewer identities are simulated.');
  return {auth_mode:process.env.KIARA_AUTH_MODE||'demo_simulated',worker_mode:process.env.KIARA_WORKER_MODE||'local',persistence:persistenceMode(),model,email,worker:!!s.worker_heartbeat&&Date.now()-Date.parse(s.worker_heartbeat)<10000,limitations,contract_release:'kiara-runtime-0.3.0',model_name:provider.configuration?.model??null,reasoning_effort:provider.configuration?.reasoning_effort??null,provider:{...provider,provider_execution_verified:evidence.completed_requests>0},inference_evidence:evidence};
}
