import {mkdir,readFile,writeFile,rename,rm,open} from 'node:fs/promises';
import {join} from 'node:path';
import {operatorDatabase} from '../data/store';
import {authorizedBudget} from '../runtime/config';
import {AppError} from './contracts';

interface Charge {id:string;reserved:number;actual:number;status:'reserved'|'settled'|'unknown';created_at:number;reconciliation?:{kind:'conservative_unknown_ceiling';actor:string;reason:string;created_at:number;reserved_micro:number;confirmed_actual_micro:number;budgeted_micro:number;original_status:'unknown';retry_authorized:false}}
interface Spend {_id:string;version:number;charges:Record<string,Charge>}
const KEY='kiara-provider-total-v1';
const micro=(usd:number)=>Math.ceil(usd*1_000_000);
const totals=(s:Spend)=>Object.values(s.charges).reduce((a,c)=>{
  const coverage=c.reconciliation?.budgeted_micro??0,covered=c.status==='unknown'&&coverage>=c.reserved&&coverage>=c.actual;
  a.actual+=c.actual;a.conservative+=Math.max(coverage-c.actual,0);a.spent+=Math.max(c.actual,coverage);
  if(c.status!=='settled'&&!covered)a.reserved+=Math.max(c.reserved-Math.max(c.actual,coverage),0);
  if(c.status==='unknown'){a.unknown++;if(!covered)a.blocking_unknown++;}
  if(c.status!=='settled'&&!covered)a.inflight++;
  return a;
},{spent:0,actual:0,conservative:0,reserved:0,unknown:0,blocking_unknown:0,inflight:0});

/** One operator ledger for ALL visitor scopes, evaluations and local acceptance using this database.
 * No reset epoch, visitor id, TTL, model-controlled key or automatic reservation expiry. */
async function change<T>(fn:(state:Spend)=>T):Promise<T>{
  if(process.env.MONGODB_URI){
    const collection=(await operatorDatabase()).collection<Spend>('provider_spend_authorization');
    for(let i=0;i<30;i++){
      const before=await collection.findOne({_id:KEY});
      const state:Spend=before?structuredClone(before):{_id:KEY,version:0,charges:{}};
      const result=fn(state);state.version++;
      if(before){const saved=await collection.replaceOne({_id:KEY,version:before.version},state,{writeConcern:{w:'majority'}});if(saved.matchedCount===1)return result;}
      else try{await collection.insertOne(state,{writeConcern:{w:'majority'}});return result;}catch(e:any){if(e.code!==11000)throw e;}
    }
    throw new AppError('SPEND_STORE_BUSY','The shared provider budget is busy; no call was dispatched.',503);
  }
  if(process.env.VERCEL)throw new AppError('SPEND_STORE_REQUIRED','Hosted provider spending requires durable MongoDB storage.',503);
  const dir=process.env.KIARA_GLOBAL_BUDGET_DIR||process.env.KIARA_DATA_DIR||join(process.cwd(),'.kiara');
  await mkdir(dir,{recursive:true,mode:0o700});
  const lock=join(dir,'provider-spend.lock'),file=join(dir,'provider-spend.json');
  let held=false;
  for(let i=0;i<500;i++){
    try{await mkdir(lock);held=true;await writeFile(join(lock,'pid'),String(process.pid),{mode:0o600});break;}catch(e:any){if(e.code!=='EEXIST')throw e;}
    // A crashed lock fails closed. An operator may remove it after confirming no process is active.
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  if(!held)throw new AppError('SPEND_STORE_BUSY','The shared local provider budget is locked; no call was dispatched.',503);
  try{
    let state:Spend;try{state=JSON.parse(await readFile(file,'utf8'));}catch(e:any){if(e.code!=='ENOENT')throw e;state={_id:KEY,version:0,charges:{}};}
    const result=fn(state);state.version++;const temp=join(dir,`provider-spend-${process.pid}.tmp`);const handle=await open(temp,'w',0o600);try{await handle.writeFile(JSON.stringify(state));await handle.sync();}finally{await handle.close();}await rename(temp,file);const directory=await open(/* turbopackIgnore: true */ dir,'r');try{await directory.sync();}finally{await directory.close();}return result;
  }finally{await rm(lock,{recursive:true,force:true});}
}

export async function reserveGlobalSpend(charge_id:string,reserved_usd:number){
  const cap=micro(authorizedBudget()),reserved=micro(reserved_usd);
  if(!/^[a-zA-Z0-9_-]{8,100}$/.test(charge_id)||!Number.isSafeInteger(reserved)||reserved<=0)throw new AppError('INVALID_SPEND_RESERVATION','Invalid provider reservation.');
  return change(s=>{
    const old=s.charges[charge_id];if(old)throw new AppError('SPEND_ID_CONFLICT','A provider reservation cannot authorize a second dispatch.');
    const t=totals(s),recent=Object.values(s.charges).filter(c=>c.created_at>Date.now()-60_000);
    if(t.blocking_unknown)throw new AppError('GLOBAL_CHARGE_UNKNOWN','A provider charge is unresolved; operator reconciliation is required.');
    if(t.spent+t.reserved+reserved>cap)throw new AppError('GLOBAL_BUDGET_EXHAUSTED','The shared provider budget is exhausted.');
    if(t.inflight>=2)throw new AppError('GLOBAL_CONCURRENCY_LIMIT','Two provider requests are already running. Retry after they finish.');
    if(recent.length>=20||Object.keys(s.charges).length>=10000)throw new AppError('GLOBAL_RATE_LIMIT','The shared provider request limit is reached.');
    s.charges[charge_id]={id:charge_id,reserved,actual:0,status:'reserved',created_at:Date.now()};
  });
}
export async function settleGlobalSpend(charge_id:string,actual_usd:number,unknown_charge=false){
  if(!Number.isFinite(actual_usd)||actual_usd<0)throw new AppError('INVALID_SPEND_SETTLEMENT','Invalid provider usage.');
  return change(s=>{
    const c=s.charges[charge_id];if(!c)return; // Reservation may have been denied before dispatch.
    const actual=micro(actual_usd);
    if(c.status==='settled'){if(c.actual!==actual||unknown_charge)throw new AppError('SPEND_SETTLEMENT_CONFLICT','Settled usage cannot be rewritten.');return;}
    if(c.status==='unknown'&&!unknown_charge)throw new AppError('GLOBAL_CHARGE_UNKNOWN','Unknown charges need explicit operator reconciliation.');
    c.actual=Math.max(c.actual,actual);c.status=unknown_charge||actual>c.reserved?'unknown':'settled';
  });
}
export async function recoverGlobalSpend(charge_id:string,dispatched:boolean){
  return change(s=>{const c=s.charges[charge_id];if(!c||c.status==='settled'||c.status==='unknown')return;if(dispatched)c.status='unknown';else{c.actual=0;c.status='settled';}});
}
export async function globalSpendStatus(){
  let state:Spend|null=null;
  if(process.env.MONGODB_URI)state=await (await operatorDatabase()).collection<Spend>('provider_spend_authorization').findOne({_id:KEY});
  else{if(process.env.VERCEL)throw new AppError('SPEND_STORE_REQUIRED','Hosted provider spending requires durable MongoDB storage.',503);try{state=JSON.parse(await readFile(join(process.env.KIARA_GLOBAL_BUDGET_DIR||process.env.KIARA_DATA_DIR||join(process.cwd(),'.kiara'),'provider-spend.json'),'utf8'));}catch(e:any){if(e.code!=='ENOENT')throw e;}}
  state||={_id:KEY,version:0,charges:{}};const t=totals(state);
  return {budget_usd:authorizedBudget(),spent_usd:t.spent/1_000_000,actual_spent_usd:t.actual/1_000_000,conservative_spent_usd:t.conservative/1_000_000,reserved_usd:t.reserved/1_000_000,unknown_charges:t.blocking_unknown,covered_unknown_charges:t.unknown-t.blocking_unknown,blocking_unknown_charges:t.blocking_unknown,inflight:t.inflight,request_count:Object.keys(state.charges).length,scope:'all_visitors_and_evaluations'};
}

/** Explicit operator action only; never called by the runtime, a visitor route, or a retry.
 * Account for the entire bounded request ceiling without claiming provider usage is known.
 * The original unknown charge and its workspace remain unresolved and cannot retry. */
export async function conservativelyAccountUnknownCharge(input:{charge_id:string;expected_reserved_usd:number;actor:string;reason:string;confirmation:'charge_full_reservation_without_retry'}){
  const expected=micro(input.expected_reserved_usd);
  if(input.confirmation!=='charge_full_reservation_without_retry'||!Number.isSafeInteger(expected)||expected<=0||!input.actor.trim()||input.actor.length>200||input.reason.trim().length<20||input.reason.length>2000)throw new AppError('INVALID_OPERATOR_RECONCILIATION','Explicit operator attribution, reason, exact ceiling, and no-retry confirmation are required.',400);
  return change(s=>{
    const c=s.charges[input.charge_id];
    if(!c||c.status!=='unknown')throw new AppError('UNKNOWN_CHARGE_REQUIRED','Only an existing unknown provider charge can be conservatively accounted.');
    if(c.reserved!==expected)throw new AppError('SPEND_RESERVATION_CHANGED','Review the exact immutable request reservation before accounting for it.');
    if(c.actual>c.reserved)throw new AppError('SPEND_CEILING_EXCEEDED','Reported usage exceeds the request ceiling; conservative coverage cannot unblock this charge.');
    if(c.reconciliation){if(c.reconciliation.actor!==input.actor||c.reconciliation.reason!==input.reason)throw new AppError('RECONCILIATION_IMMUTABLE','Operator reconciliation history cannot be rewritten.');return c.reconciliation;}
    const reconciliation={kind:'conservative_unknown_ceiling' as const,actor:input.actor,reason:input.reason,created_at:Date.now(),reserved_micro:c.reserved,confirmed_actual_micro:c.actual,budgeted_micro:c.reserved,original_status:'unknown' as const,retry_authorized:false as const};
    c.reconciliation=reconciliation;return reconciliation;
  });
}
