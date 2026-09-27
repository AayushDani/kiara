import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectEcfrTitleCurrentness} from '../src/v2/legal-reference-ecfr';

const catalog={titles:[{number:16,name:'Commercial Practices',latest_amended_on:'2026-09-24',latest_issue_date:'2026-09-24',up_to_date_as_of:'2026-09-24',reserved:false}],meta:{date:'2026-09-24',import_in_progress:false}};
const reply=(body:unknown,headers:Record<string,string>={'content-type':'application/json'})=>new Response(JSON.stringify(body),{status:200,headers});
const code=(expected:string)=>(error:unknown)=>(error as {code?:string}).code===expected;

test('bounded eCFR title read returns an unreviewed title-level currentness signal',async()=>{
 let requested='';
 const result=await inspectEcfrTitleCurrentness(16,async(input,init)=>{requested=String(input);assert.equal(init?.redirect,'error');assert.equal(init?.credentials,'omit');return reply(catalog);});
 assert.equal(requested,'https://www.ecfr.gov/api/versioner/v1/titles.json');
 assert.equal(result.latestAmendedOn,'2026-09-24');
 assert.equal(result.upToDateAsOf,'2026-09-24');
 assert.equal(result.status,'unreviewed_discovery');
 assert.equal('verifiedAt' in result,false);
});

test('eCFR catalog errors, reserved titles, malformed dates and oversized responses fail closed',async()=>{
 await assert.rejects(inspectEcfrTitleCurrentness(0,async()=>reply(catalog)),code('ECFR_TITLE_REQUIRED'));
 await assert.rejects(inspectEcfrTitleCurrentness(16,async()=>new Response('rate limited',{status:429})),code('ECFR_RATE_LIMIT'));
 await assert.rejects(inspectEcfrTitleCurrentness(16,async()=>reply({...catalog,meta:{date:'2026-09-24',import_in_progress:'false'}})),code('ECFR_METADATA_FORMAT'));
 await assert.rejects(inspectEcfrTitleCurrentness(16,async()=>reply({...catalog,titles:[{...catalog.titles[0],up_to_date_as_of:'2026-02-30'}]})),code('ECFR_METADATA_FORMAT'));
 await assert.rejects(inspectEcfrTitleCurrentness(16,async()=>reply({...catalog,titles:[{...catalog.titles[0],reserved:true}]})),code('ECFR_TITLE_UNAVAILABLE'));
 await assert.rejects(inspectEcfrTitleCurrentness(16,async()=>reply(catalog,{'content-type':'application/json','content-length':'128001'})),code('ECFR_CAPACITY'));
 await assert.rejects(inspectEcfrTitleCurrentness(16,async()=>new Response('<html>error</html>',{status:200,headers:{'content-type':'text/html'}})),code('ECFR_METADATA_FORMAT'));
});
