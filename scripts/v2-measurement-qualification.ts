import {readFile,stat} from 'node:fs/promises';
import {qualifyPairedCases,type PairedCaseManifest} from '../src/v2/measurement-qualification';
import {closeV2Store,readWorkspace} from '../src/v2/store';

const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const boundedString=(value:unknown,max=200):value is string=>typeof value==='string'&&value.length>0&&value.length<=max;
const ids=(value:unknown):value is string[]=>Array.isArray(value)&&value.length<=1000&&value.every(item=>boundedString(item));
const sha256=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function caseRef(value:unknown){return object(value)&&boundedString(value.matterId)&&sha256(value.outcomeHash)&&boundedString(value.usefulnessReceiptId)&&ids(value.actionIds)&&ids(value.participantIds)&&ids(value.effortEntryIds);}
function validManifest(value:unknown):value is PairedCaseManifest {
 if(!object(value)||!boundedString(value.tenantId)||!boundedString(value.comparisonScope,3000)||!boundedString(value.baselineRecordId)||!caseRef(value.baseline)||!caseRef(value.current))return false;
 const q=value.quality;
 return q===null||object(q)&&boundedString(q.reviewerId)&&Number.isSafeInteger(q.reviewerMembershipVersion)&&Number(q.reviewerMembershipVersion)>0&&boundedString(q.reviewedAt,100)&&sha256(q.artifactDigest)&&boundedString(q.comparisonScope,3000)&&sha256(q.baselineOutcomeHash)&&sha256(q.currentOutcomeHash)&&sha256(q.baselineValueEvidenceHash)&&sha256(q.currentValueEvidenceHash)&&['equivalent_quality','not_equivalent','unresolved'].includes(String(q.verdict));
}

async function main(){
 const [tenantId,manifestPath,artifactPath,...extra]=process.argv.slice(2);
 if(!boundedString(tenantId)||!boundedString(manifestPath,4096)||artifactPath!==undefined&&!boundedString(artifactPath,4096)||extra.length)throw new Error('INPUT_INVALID');
 const info=await stat(manifestPath);
 if(!info.isFile()||info.size>128_000)throw new Error('INPUT_INVALID');
 const bytes=await readFile(manifestPath);
 if(bytes.byteLength>128_000)throw new Error('INPUT_INVALID');
 let parsed:unknown;
 try{parsed=JSON.parse(bytes.toString('utf8'));}catch{throw new Error('INPUT_INVALID');}
 if(!validManifest(parsed)||parsed.tenantId!==tenantId)throw new Error('INPUT_INVALID');
 let artifactBytes:Uint8Array|undefined;
 if(artifactPath){
  const artifactInfo=await stat(artifactPath);
  if(!artifactInfo.isFile()||artifactInfo.size<2||artifactInfo.size>32_768)throw new Error('INPUT_INVALID');
  artifactBytes=await readFile(artifactPath);
  if(artifactBytes.byteLength<2||artifactBytes.byteLength>32_768)throw new Error('INPUT_INVALID');
 }
 const state=await readWorkspace(tenantId);
 const result=qualifyPairedCases(state,parsed,artifactBytes);
 process.stdout.write(`${JSON.stringify(result)}\n`);
 if(result.status==='incomplete')process.exitCode=1;
}

main().catch(error=>{
 process.stderr.write(`${JSON.stringify({status:'error',code:error instanceof Error&&error.message==='INPUT_INVALID'?'INPUT_INVALID':'READ_FAILED'})}\n`);
 process.exitCode=2;
}).finally(async()=>{await closeV2Store();});
