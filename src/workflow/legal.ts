import type {Assessment,Fact} from '../server/contracts';

// Named screening fields are the contract; a count of unrelated false properties is not a screen.
export const EXEMPTION_SCREEN_KEYS=Object.freeze(['healthAndClinicalResearch','regulatedFinancialInformation','fcraRegulatedActivity','dppaData','vehicleOrVesselRecall','educationalAssessment','commercialCreditReporting','publicOrDeidentifiedOnly','privilegedCommunication','lawEnforcementHold','otherSpecializedClaim']);
const businessKeys=['for_profit','collects_personal_information','determines_purposes_and_means','does_business_in_california'];
const alternativeKeys=['related_entity_business_route','joint_venture_business_route','voluntary_cppa_certification'];
export function assess(facts:Fact[],asOf:string=new Date().toISOString()):Assessment {
  const year=new Date(asOf).getUTCFullYear(),priorYear=year-1;
  if(year!==2026)return {outcome:'needs_information',summary:'The retained California rule set is reviewed only for 2026. A lawyer must refresh the sources for this assessment date.',missing_facts:['unsupported_rule_period'],basis:[],criteria:[]};
  const by=new Map(facts.map(f=>[f.fact_key,f]));
  const booleans=new Set([...businessKeys,...alternativeKeys,'natural_person','ordinary_signup_data_nonexempt','wholly_outside_california_exception']);
  const numbers=new Set(['annual_gross_revenue_usd','prior_calendar_year','annual_buy_sell_share_ca_consumers_or_households','sale_share_revenue_percent']);
  const value=(key:string):unknown=>{
    const f=by.get(key);if(f?.knowledge!=='known'||f.value===null)return undefined;
    const v=f.value;
    if(booleans.has(key)&&typeof v!=='boolean')return undefined;
    if(numbers.has(key)&&(typeof v!=='number'||!Number.isFinite(v)||v<0))return undefined;
    if(key==='prior_calendar_year'&&(!Number.isInteger(v)||v!==priorYear))return undefined;
    if(key==='sale_share_revenue_percent'&&typeof v==='number'&&v>100)return undefined;
    if(key==='annual_buy_sell_share_ca_consumers_or_households'&&!Number.isInteger(v))return undefined;
    if(key==='declared_legal_residence'&&(typeof v!=='string'||!/^US-[A-Z]{2}$/.test(v)))return undefined;
    return v;
  };
  const missing:string[]=[],basis:string[]=[],criteria:Assessment['criteria']=[];
  const need=(key:string)=>{const v=value(key);if(v===undefined)missing.push(key);return v;};
  const row=(key:string,v:unknown)=>criteria.push({label:key.replaceAll('_',' '),result:v===true?'pass':v===false?'fail':'unknown',evidence:'Pinned company fact: '+key});
  // Each alternative fact represents the complete separately verified statutory route.
  const and=(xs:unknown[])=>xs.some(v=>v===false)?false:xs.every(v=>v===true)?true:undefined;
  const or=(xs:unknown[])=>xs.some(v=>v===true)?true:xs.every(v=>v===false)?false:undefined;
  let outcome:Assessment['outcome']='needs_information';
  const residence=need('declared_legal_residence');
  if(residence&&residence!=='US-CA'){missing.push('unsupported_jurisdiction');basis.push('Only California consumer privacy is supported by this retained rule set. A lawyer must assess the declared jurisdiction.');}
  else if(residence==='US-CA'){
    const scope=['natural_person','ordinary_signup_data_nonexempt'].map(k=>{const v=need(k);row(k,v);return v;});
    for(const key of businessKeys)row(key,value(key));
    const revenueValue=value('annual_gross_revenue_usd'),revenueYear=value('prior_calendar_year'),volume=value('annual_buy_sell_share_ca_consumers_or_households'),share=value('sale_share_revenue_percent');
    const revenue=typeof revenueValue==='number'&&revenueYear===priorYear?revenueValue>26625000:undefined;
    const volumeRoute=typeof volume==='number'?volume>=100000:undefined,shareRoute=typeof share==='number'?share>=50:undefined;
    criteria.push({label:`${priorYear} gross revenue exceeds $26,625,000`,result:revenue===undefined?'unknown':revenue?'pass':'fail',evidence:'Civil Code §1798.140(d)(1)(A) · CPPA 2025 CPI adjustment'});
    const direct=and([...businessKeys.map(value),or([revenue,volumeRoute,shareRoute])]);
    const related=value(alternativeKeys[0]),joint=value(alternativeKeys[1]);
    const certified=and([value('voluntary_cppa_certification'),value('does_business_in_california')]);
    for(const key of alternativeKeys)row(key,key==='voluntary_cppa_certification'?certified:value(key));
    const business=or([direct,related,joint,certified]);
    const screen=need('exemption_screen');
    const object=screen&&typeof screen==='object'&&!Array.isArray(screen)?screen as Record<string,unknown>:null;
    const complete=!!object&&EXEMPTION_SCREEN_KEYS.every(key=>Object.hasOwn(object,key)&&object[key]===false)&&Object.keys(object).every(key=>key==='scope'||EXEMPTION_SCREEN_KEYS.includes(key))&&typeof object.scope==='string'&&object.scope.trim().length>0;
    const outside=need('wholly_outside_california_exception');
    if(!complete||outside===true)missing.push('lawyer_exemption_scope_review');
    if(scope.some(v=>v===false)){outcome='not_covered';basis.push('A consumer or assessed data-scope criterion is explicitly false.');}
    else if(missing.length){outcome='needs_information';}
    else if(business===true){outcome='covered';basis.push(direct===true?(revenue?'Revenue prong: explicit 2025 gross revenue exceeds the operative $26,625,000 threshold.':volumeRoute?'Volume prong: at least 100,000 California consumers or households.':'At least 50% of annual revenue derives from sale or sharing.'):'An explicitly verified alternative business route applies independently of direct-business prerequisites.');}
    else if(business===false){outcome='not_covered';basis.push('All assessed business routes are explicitly false. Equality with the revenue threshold does not satisfy “in excess of”.');}
    else {outcome='needs_information';for(const key of [...businessKeys,'annual_gross_revenue_usd','prior_calendar_year','annual_buy_sell_share_ca_consumers_or_households','sale_share_revenue_percent',...alternativeKeys])if(value(key)===undefined)missing.push(key);}
  }
  return {outcome,summary:outcome==='covered'?'The pinned company facts support the assessed California applicability criteria. Proposed policy changes require founder and lawyer review.':outcome==='needs_information'?'Applicability is unresolved. Missing or conflicting facts must be resolved before a draft can enter review.':'CCPA coverage is not established for this assessed scope. Other obligations may still apply.',missing_facts:[...new Set(missing)],basis,criteria};
}
export {requiredEvidence, contextCheck, validateProposal} from '../validation/proposal';
export function fixtureFacts(input:Record<string,any>):Fact[]{return Object.entries(input).map(([key,f])=>({fact_id:f.factId,fact_key:key.replace(/[A-Z]/g,m=>'_'+m.toLowerCase()),knowledge:f.knowledgeState==='known'?'known':f.knowledgeState==='conflicted'?'conflicted':'unknown',value:f.value,provenance:'Frozen legal evaluation fixture'}));}
