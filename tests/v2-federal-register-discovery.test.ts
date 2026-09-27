import test from 'node:test';
import assert from 'node:assert/strict';
import {discoverFederalRegisterCfrPart} from '../src/v2/legal-reference-federal-register';

const document={document_number:'2022-08804',title:'Safety Standard for Baby Changing Products',type:'Rule',publication_date:'2022-04-26',html_url:'https://www.federalregister.gov/documents/2022/04/26/2022-08804/safety-standard-for-baby-changing-products',pdf_url:'https://www.govinfo.gov/content/pkg/FR-2022-04-26/pdf/2022-08804.pdf'};
const reply=(body:unknown,headers:Record<string,string>={'content-type':'application/json'})=>new Response(JSON.stringify(body),{status:200,headers});
const code=(expected:string)=>(error:unknown)=>(error as {code?:string}).code===expected;

test('exact CFR part discovery returns only a bounded unreviewed first page and official links',async()=>{
 let requested='';
 const result=await discoverFederalRegisterCfrPart(16,1235,async(input,init)=>{requested=String(input);assert.equal(init?.redirect,'error');assert.equal(init?.credentials,'omit');return reply({count:12,results:[document]});});
 const url=new URL(requested);
 assert.equal(url.origin,'https://www.federalregister.gov');
 assert.equal(url.searchParams.get('conditions[cfr][title]'),'16');
 assert.equal(url.searchParams.get('conditions[cfr][part]'),'1235');
 assert.equal(url.searchParams.get('per_page'),'10');
 assert.equal(result.status,'unreviewed_discovery');
 assert.equal(result.moreResults,true);
 assert.equal(result.documents[0].officialPdfUrl,document.pdf_url);
 assert.equal('verifiedAt' in result,false);
});

test('invalid selection and untrusted or mismatched document metadata fail closed',async()=>{
 await assert.rejects(discoverFederalRegisterCfrPart(0,1235,async()=>reply({count:0,results:[]})),code('FR_CFR_SELECTION_REQUIRED'));
 await assert.rejects(discoverFederalRegisterCfrPart(16,1235,async()=>reply({count:1,results:[{...document,pdf_url:'https://evil.example/content/pkg/FR-2022-04-26/pdf/2022-08804.pdf'}]})),code('FR_METADATA_FORMAT'));
 await assert.rejects(discoverFederalRegisterCfrPart(16,1235,async()=>reply({count:1,results:[{...document,publication_date:'2022-02-30'}]})),code('FR_METADATA_FORMAT'));
 await assert.rejects(discoverFederalRegisterCfrPart(16,1235,async()=>reply({count:1,results:[{...document,pdf_url:'https://www.govinfo.gov/content/pkg/FR-2022-04-26/pdf/2021-08804.pdf'}]})),code('FR_METADATA_FORMAT'));
 await assert.rejects(discoverFederalRegisterCfrPart(16,1235,async()=>reply({count:1,results:[{...document,type:'Unknown'}]})),code('FR_METADATA_FORMAT'));
});

test('response errors and size bounds fail closed',async()=>{
 await assert.rejects(discoverFederalRegisterCfrPart(16,1235,async()=>new Response('rate limited',{status:429})),code('FR_RATE_LIMIT'));
 await assert.rejects(discoverFederalRegisterCfrPart(16,1235,async()=>reply({count:1,results:[document]},{'content-type':'application/json','content-length':'512001'})),code('FR_CAPACITY'));
 await assert.rejects(discoverFederalRegisterCfrPart(16,1235,async()=>new Response('<html/>',{headers:{'content-type':'text/html'}})),code('FR_METADATA_FORMAT'));
 await assert.rejects(discoverFederalRegisterCfrPart(16,1235,async()=>reply({count:0,results:[document]})),code('FR_METADATA_FORMAT'));
});
