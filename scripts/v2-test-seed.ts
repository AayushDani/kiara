import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import ConnectionString from 'mongodb-connection-string-url';
import {command} from '../src/v2/service';
import {closeV2Store,digest,readWorkspace} from '../src/v2/store';
import {closeOidcIdentityStore,operatorOidcBindingForActor} from '../src/v2/oidc-identities';
import type {ActorContext,WorkspaceCommand,WorkspaceState} from '../src/v2/contracts';

const TENANT='synthetic-test-preview';
const PACK=join(dirname(fileURLToPath(import.meta.url)),'../docs/kiara-delivery/test-company-seed');
const files=[
 ['company-context.md','7e4a170788507e25554d34ab9ee48b348ff7cea01b01f592a7de613b2f25968a','other'],
 ['candidate-privacy-notice.md','8f9d2f12ba04a0106141fd4021b652fe3381acb9e1ef8d79e1eb0234b202870a','notice'],
 ['candidate-terms.md','d3fe80c46fa5ed7b08cf549ca7622498b6df08bc861254a4bddb8bdf616b2de1','draft'],
 ['employer-terms.md','52924cfeec24a01922917cfc91cbc5c9a379e044edc0faf25bfc22b294cc5364','draft'],
 ['data-processing-addendum.md','a0eaffc6c1342c1f268ca9e69dd534a1f9ba0462101f504386032074d48b5bd0','draft'],
 ['ai-matching-review.md','93089fc379c9add1bda5e7f83c3093bf70dba191ea2909115d9adffdae748a84','draft'],
 ['privacy-operations.md','4293f9c82b9041813bb83fe5f6c2ee035358627a8d29bef5ee9d22751612a298','draft'],
 ['job-and-application-record.md','b127974b21b935de0f66e823453678ef13165b6a69a254275e7cbafb77b8f63e','other'],
 ['profile-visibility-history.md','2144c72e261656b4c85bcf691091b9db2d2851d5585fa9fff5303b5081901daa','other'],
 ['employer-order.md','c79a8ce6c1f01de228188fc3669a9a1683bdbd215e411c140c7f423cbcdb5e61','draft'],
 ['vendor-data-inventory.md','e39cced30433594d00c82fe24cbba796db85bb16dc398fd3b67fbd00ef0b7cc2','other'],
 ['retention-decision-register.md','2ea3a6f903b24b1ba1818c0324353dc051b9f4e6ca5e7e57e2c138e776467e69','other'],
 ['privacy-request-case.md','b0deb54b4ee718d677d7d1992f20406101af1a037af3803139edb1ff36e51801','other'],
 ['match-evaluation-record.md','9f2a51f721ba871f493c3077847423333ef169f163a0afd1352c8c7d9e2cb509','other'],
 ['access-incident-case.md','b614c2bfd1eab38bc9f838c37fbf82df67e8a217ebc9d8db23a24bfa2c11a3f6','other'],
] as const;
const pilotHash='2d39791bdcb7477f15f7d9a6134fa25e74f96178f21be3a98f0bc2d956bb7f06';
const matterSpecs=[
 {title:'Test · candidate deletion request',heading:'## Matter 1 · candidate deletion request'},
 {title:'Test · NYC matching launch review',heading:'## Matter 2 · NYC matching launch review'},
] as const;
const factSpecs=[
 {predicate:'test_pilot_business_model',value:'Synthetic pilot declaration: Test proposes a US technology hiring marketplace for candidates and verified employer recruiters.'},
 {predicate:'test_pilot_profile_visibility',value:'Synthetic pilot design: candidate profiles start private; candidates may choose employer visibility. An application is a separate share with the selected employer.'},
 {predicate:'test_pilot_matching',value:'Synthetic pilot design: Test Match suggests roles and eligible profiles; no automatic hiring or rejection. Production behavior and legal applicability remain unverified.'},
] as const;
type Doc={file:string;title:string;body:string;fileSha256:string;contentHash:string;kind:'other'|'notice'|'draft'};
type MatterSpec={title:string;objective:string};
type Pack={documents:Doc[];matters:MatterSpec[];hash:string};
type Step={key:string;command:WorkspaceCommand;note:string};
export type SeedInput={phase:'preview'|'apply';tenantId:string;actorId:string;expectedVersion:number;previewHash?:string};
const sha256=(value:Buffer)=>createHash('sha256').update(value).digest('hex');

export function parseSeedInput(args:string[]):SeedInput{
 const [phase,tenantId,actorId,rawVersion,previewHash,...extra]=args;
 if(!['preview','apply'].includes(phase)||tenantId!==TENANT||!actorId||actorId.length>200||!/^(0|[1-9]\d*)$/.test(rawVersion||'')||!Number.isSafeInteger(Number(rawVersion))||extra.length||
   phase==='preview'&&previewHash!==undefined||phase==='apply'&&!/^[a-f0-9]{64}$/i.test(previewHash||''))
  throw new Error('Usage: v2:test-seed <preview|apply> synthetic-test-preview <bound-actor-id> <inspected-version> [preview-hash-for-apply]');
 return {phase:phase as SeedInput['phase'],tenantId,actorId,expectedVersion:Number(rawVersion),...(previewHash?{previewHash:previewHash.toLowerCase()}:{})};
}

/** Only the committed Test source bytes are accepted. Legal source URLs are a review queue, not retained originals. */
export async function loadTestPack():Promise<Pack>{
 const documents:Doc[]=[];
 for(const [file,expected,kind] of files){
  const bytes=await readFile(join(PACK,file)),fileSha256=sha256(bytes);
  if(fileSha256!==expected)throw new Error(`Committed Test seed changed: ${file}`);
  const body=bytes.toString('utf8').trim(),title=body.match(/^# (.+)$/m)?.[1];
  if(!title||!body)throw new Error(`Test seed is missing a title or body: ${file}`);
  documents.push({file,title,body,fileSha256,contentHash:digest(body),kind});
 }
 const pilotBytes=await readFile(join(PACK,'pilot-matters.md'));
 if(sha256(pilotBytes)!==pilotHash)throw new Error('Committed Test pilot matters changed.');
 const pilot=pilotBytes.toString('utf8'),matters=matterSpecs.map(({title,heading})=>{
  const start=pilot.indexOf(heading),next=pilot.indexOf('\n## ',start+heading.length);
  if(start<0)throw new Error(`Missing Test matter: ${title}`);
  const objective=pilot.slice(start+heading.length,next<0?undefined:next).trim();
  if(!objective||objective.length>5000)throw new Error(`Invalid Test matter objective: ${title}`);
  return {title,objective};
 });
 return {documents,matters,hash:digest({documents:documents.map(d=>[d.file,d.fileSha256,d.contentHash,d.kind]),pilotHash,factSpecs,matters})};
}

function assertCleanSeedScope(s:WorkspaceState,actorId:string,pack:Pack){
 if(s.tenantId!==TENANT||s.rehearsal||s.migration||!['Your company','Test'].includes(s.companyName))throw new Error('Expected a clean synthetic Test workspace.');
 const member=s.memberships.find(m=>m.actorId===actorId);
 if(s.memberships.length!==1||!member||member.revokedAt||member.expiresAt&&Date.parse(member.expiresAt)<=Date.now()||!['member','business_owner','fact_owner'].every(role=>member.roles.includes(role as typeof member.roles[number])))
  throw new Error('Seed actor needs the only current membership with member, business_owner and fact_owner roles.');
 const expectedTitles=new Set(pack.documents.map(d=>d.title));
 if(s.documents.length>pack.documents.length||s.documents.some(d=>!expectedTitles.has(d.title)||d.provenance.actorId!==actorId||d.authority!=='draft'||d.status!=='current'||d.revision!==1))throw new Error('Workspace contains unrelated or changed documents.');
 for(const doc of pack.documents){const matches=s.documents.filter(d=>d.title===doc.title);if(matches.length>1||matches.length===1&&(matches[0].body!==doc.body||matches[0].contentHash!==doc.contentHash||matches[0].kind!==doc.kind))throw new Error(`Test document does not match committed seed: ${doc.file}`);}
 const sourceIds=new Set(s.documents.map(d=>d.sourceId));
 if(s.sources.length!==s.documents.length||s.sources.some(source=>!sourceIds.has(source.id)||source.provenance.actorId!==actorId||source.status!=='active'||source.authority!=='draft'||source.contentHash!==digest(source.text)||!s.documents.some(d=>d.sourceId===source.id&&d.body===source.text)))throw new Error('Workspace contains unrelated or changed sources.');
 const matterTitles=new Set(pack.matters.map(m=>m.title));
 if(s.matters.length>pack.matters.length||s.matters.some(m=>!matterTitles.has(m.title)||m.provenance.actorId!==actorId||m.state!=='needs_facts'))throw new Error('Workspace contains unrelated or advanced matters.');
 for(const matter of pack.matters){const matches=s.matters.filter(m=>m.title===matter.title);if(matches.length>1||matches.length===1&&matches[0].objective!==matter.objective)throw new Error(`Test matter does not match committed seed: ${matter.title}`);}
 const predicates=new Set<string>(factSpecs.map(f=>f.predicate));
 const contextSource=s.documents.find(d=>d.title===pack.documents[0].title)?.sourceId;
 if(s.facts.length>factSpecs.length||s.facts.some(f=>!predicates.has(f.predicate)||f.ownerId!==actorId||f.practice!=='planned'||!['candidate','confirmed'].includes(f.status)||f.reuse!=='company'||!contextSource||f.provenance.sourceIds.length!==1||f.provenance.sourceIds[0]!==contextSource))throw new Error('Workspace contains unrelated or changed facts.');
 for(const fact of factSpecs){const matches=s.facts.filter(f=>f.predicate===fact.predicate);if(matches.length>1||matches.length===1&&matches[0].value!==fact.value)throw new Error(`Test fact does not match committed seed: ${fact.predicate}`);}
 if(s.conversations.length||s.messages.length||s.scenarios.length||s.legalAuthorities.length||s.coverage.length||s.proposals.length||s.approvals.length||s.actions.length||s.counsel.length||s.connections.length||s.tombstones.length||s.learning.length||s.preferences.length||s.obligations?.length||s.memoryEntities?.length||s.memoryRelationships?.length)
  throw new Error('Workspace has other activity; use a new empty synthetic tenant.');
}

export function seedPlan(s:WorkspaceState,actorId:string,pack:Pack,storeFingerprint:string,binding:{key:string;version:number}){
 assertCleanSeedScope(s,actorId,pack);
 const steps:Step[]=[];
 if(s.companyName!=='Test')steps.push({key:'company',command:{type:'company.configure',name:'Test'},note:'Set fictional pilot company name'});
 for(const doc of pack.documents)if(!s.documents.some(d=>d.title===doc.title))steps.push({key:`document:${doc.file}`,command:{type:'document.add',title:doc.title,body:doc.body,authority:'draft',kind:doc.kind,scope:{kind:'team',actorIds:[]}},note:`Retain unsigned draft ${doc.file}`});
 const context=s.documents.find(d=>d.title===pack.documents[0].title);
 for(const fact of factSpecs){const current=s.facts.find(f=>f.predicate===fact.predicate);if(!current)steps.push({key:`fact:${fact.predicate}`,command:{type:'fact.propose',predicate:fact.predicate,value:fact.value,practice:'planned',reuse:'company',sourceIds:context?[context.sourceId]:[]},note:'Propose attributed synthetic pilot fact'});if(!current||current.status==='candidate')steps.push({key:`confirm:${fact.predicate}`,command:current?{type:'fact.confirm',factId:current.id,expectedRecordVersion:current.version,expectedOriginVersion:current.originVersion}:{type:'fact.confirm',factId:'<resolved after proposal>',expectedRecordVersion:1,expectedOriginVersion:0},note:'Fact owner confirms planned synthetic assertion'});}
 for(const matter of pack.matters)if(!s.matters.some(m=>m.title===matter.title))steps.push({key:`matter:${matter.title}`,command:{type:'matter.create',title:matter.title,objective:matter.objective,scope:{kind:'team',actorIds:[]}},note:'Open pending synthetic assessment, no external action'});
 const exact={tenantId:TENANT,actorId,expectedVersion:s.version,stateHash:digest(s),packHash:pack.hash,storeFingerprint,binding,steps:steps.map(step=>({key:step.key,commandHash:digest(step.command)}))};
 return {...exact,previewHash:digest(exact),steps:steps.map(({key,note})=>({key,note})),documents:pack.documents.map(({file,fileSha256,contentHash})=>({file,fileSha256,contentHash})),legalSourceState:'not_intaked_or_reviewed',externalEffectsAuthorized:false};
}

function assertTarget(env:NodeJS.ProcessEnv,input:SeedInput){
 if(input.tenantId!==TENANT||env.KIARA_V2_RELEASE_SYNTHETIC_TENANT!==TENANT||env.KIARA_V2_STORE_MODE!=='normalized'||env.MONGODB_DB!=='kiara_v2'||env.KIARA_V2_RELEASE_DB!=='kiara_v2'||!env.MONGODB_URI||env.KIARA_OIDC_IDENTITY_SOURCE&&env.KIARA_OIDC_IDENTITY_SOURCE!=='mongo')throw new Error('Test seed requires the exact synthetic Test tenant on the normalized Atlas release database with Mongo OIDC bindings.');
 let url:ConnectionString;try{url=new ConnectionString(env.MONGODB_URI);}catch{throw new Error('Test seed requires a valid Atlas MongoDB URI.');}
 if(url.protocol!=='mongodb+srv:'||url.hosts.length!==1||!url.hosts[0].toLowerCase().endsWith('.mongodb.net'))throw new Error('Test seed requires an Atlas SRV target.');
}

/** Apply uses ordinary authorized commands, one at a time; a changed workspace requires a new preview. */
export async function runTestSeed(input:SeedInput,env:NodeJS.ProcessEnv=process.env){
 assertTarget(env,input);
 const pack=await loadTestPack(),binding=await operatorOidcBindingForActor(input.tenantId,input.actorId),s=await readWorkspace(input.tenantId);
 if(s.version!==input.expectedVersion)throw new Error('Workspace version changed; inspect and preview again.');
 const fingerprint=digest([env.MONGODB_URI,env.MONGODB_DB]);
 const plan=seedPlan(s,input.actorId,pack,fingerprint,binding);
 if(input.phase==='preview')return {...plan,phase:'preview'};
 if(plan.previewHash!==input.previewHash)throw new Error('Test seed preview changed; preview again.');
 const actor:ActorContext={tenantId:input.tenantId,actorId:input.actorId,mode:'authenticated',expiresAt:Date.now()+300000,oidcBinding:binding};
 const applied:string[]=[];
 let expectedVersion=plan.expectedVersion;
 for(const planned of plan.steps){
  const current=await readWorkspace(input.tenantId);
  if(current.version!==expectedVersion)throw new Error('Workspace changed during seed apply; inspect and preview the remaining steps.');
  const fresh=seedPlan(current,input.actorId,pack,fingerprint,binding);
  if(!fresh.steps.some(step=>step.key===planned.key))continue;
  const step=buildStep(planned.key,current,pack);
  if(!step)throw new Error(`Seed step cannot be resolved: ${planned.key}`);
  const result=await command(actor,{idempotencyKey:`test-seed:${pack.hash.slice(0,16)}:${step.key}`,expectedVersion:current.version,command:step.command});
  expectedVersion=result.snapshot.version;
  applied.push(step.key);
 }
 const after=await readWorkspace(input.tenantId),remaining=seedPlan(after,input.actorId,pack,fingerprint,binding);
 return {phase:'applied',tenantId:TENANT,actorId:input.actorId,packHash:pack.hash,applied,remaining:remaining.steps,version:after.version,stateHash:digest(after),documents:remaining.documents,legalSourceState:'not_intaked_or_reviewed',externalEffectsAuthorized:false};
}

function buildStep(key:string,s:WorkspaceState,pack:Pack):Step|undefined{
 if(key==='company')return {key,command:{type:'company.configure',name:'Test'},note:''};
 if(key.startsWith('document:')){const doc=pack.documents.find(d=>key===`document:${d.file}`);return doc&&{key,command:{type:'document.add',title:doc.title,body:doc.body,authority:'draft',kind:doc.kind,scope:{kind:'team',actorIds:[]}},note:''};}
 if(key.startsWith('fact:')){const fact=factSpecs.find(f=>key===`fact:${f.predicate}`),context=s.documents.find(d=>d.title===pack.documents[0].title);return fact&&context&&{key,command:{type:'fact.propose',predicate:fact.predicate,value:fact.value,practice:'planned',reuse:'company',sourceIds:[context.sourceId]},note:''};}
 if(key.startsWith('confirm:')){const fact=s.facts.find(f=>key===`confirm:${f.predicate}`);return fact&&{key,command:{type:'fact.confirm',factId:fact.id,expectedRecordVersion:fact.version,expectedOriginVersion:fact.originVersion},note:''};}
 if(key.startsWith('matter:')){const matter=pack.matters.find(m=>key===`matter:${m.title}`);return matter&&{key,command:{type:'matter.create',title:matter.title,objective:matter.objective,scope:{kind:'team',actorIds:[]}},note:''};}
}

if(import.meta.url===`file://${process.argv[1]}`){
 runTestSeed(parseSeedInput(process.argv.slice(2))).then(report=>process.stdout.write(`${JSON.stringify(report,null,2)}\n`))
  .catch(error=>{process.stderr.write(`${error instanceof Error?error.message:'Test seed failed.'}\n`);process.exitCode=1;})
  .finally(async()=>{await Promise.allSettled([closeOidcIdentityStore(),closeV2Store()]);});
}
