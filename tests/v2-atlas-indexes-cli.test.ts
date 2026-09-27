import test from 'node:test';
import assert from 'node:assert/strict';
import {hybridIndexDefinitions,type HybridConfig} from '../src/v2/hybrid';
import {parseAtlasIndexCommand,runAtlasIndexCommand,type AtlasIndexAdapter} from '../scripts/v2-atlas-indexes';

const database='kiara_release_synthetic';
const uri='mongodb+srv://kiara-fixture.invalid.mongodb.net/';
const env:NodeJS.ProcessEnv={NODE_ENV:'test',KIARA_V2_ATLAS_URI:uri,MONGODB_DB:database,KIARA_V2_RELEASE_SYNTHETIC_DB:database,KIARA_V2_RETRIEVAL_MODE:'atlas',KIARA_V2_ATLAS_SEARCH_INDEX:'keyword_v1',KIARA_V2_ATLAS_VECTOR_INDEX:'vector_v1'};
type Row=Awaited<ReturnType<AtlasIndexAdapter['list']>>[number];
function fixture(initial:Row[]=[]){
  const rows=[...initial];let writes=0,reads=0,closed=0;
  const factory=async(_uri:string,_database:string,_collection:string):Promise<AtlasIndexAdapter>=>({
    list:async()=>{reads++;return rows.map(x=>({...x}));},
    create:async index=>{writes++;rows.push({name:index.name,type:index.type,status:'BUILDING',queryable:false,latestDefinition:index.definition});return index.name;},
    close:async()=>{closed++;}
  });
  return {rows,factory,get writes(){return writes;},get reads(){return reads;},get closed(){return closed;}};
}
const command=(phase:'preview'|'apply'|'verify',previewHash?:string)=>({phase,database,...(previewHash?{previewHash}:{})});

test('preview shows exact definitions and missing state without creating indexes',async()=>{
  const fake=fixture(),result=await runAtlasIndexCommand(command('preview'),env,fake.factory);
  assert.equal(result.collection,'v2_search_chunks');assert.equal(result.indexes.length,2);
  assert.equal(result.indexes[0].current,null);assert.equal(result.indexes[1].current,null);
  assert.deepEqual(result.indexes.map(x=>x.expectedDefinition),hybridIndexDefinitions(config()).map(x=>x.definition));
  assert.match(result.previewHash,/^[a-f0-9]{64}$/);assert.equal(fake.writes,0);assert.equal(fake.reads,1);assert.equal(fake.closed,1);
});

function config():HybridConfig{return {collection:'v2_search_chunks',searchIndex:'keyword_v1',vectorIndex:'vector_v1',embeddingPolicyHash:'unused-by-definitions',protocol:'kiara-atlas-chunks-1'};}

test('apply requires the same previewed target and state before any creation',async()=>{
  const fake=fixture(),preview=await runAtlasIndexCommand(command('preview'),env,fake.factory);
  await assert.rejects(runAtlasIndexCommand(command('apply','0'.repeat(64)),env,fake.factory),/preview again/);
  await assert.rejects(runAtlasIndexCommand(command('apply',preview.previewHash),{...env,KIARA_V2_ATLAS_VECTOR_INDEX:'different_vector'},fake.factory),/preview again/);
  assert.equal(fake.writes,0);
  const pending=await runAtlasIndexCommand(command('apply',preview.previewHash),env,fake.factory);
  assert.deepEqual(pending.created,['keyword_v1','vector_v1']);assert.equal(pending.ready,false);assert.equal(fake.writes,2);
  await assert.rejects(runAtlasIndexCommand(command('apply',preview.previewHash),env,fake.factory),/preview again/);
});

test('readiness requires both exact definitions, READY, queryable and ready shards',async()=>{
  const definitions=hybridIndexDefinitions(config());
  const ready=definitions.map(x=>({name:x.name,type:x.type,status:'READY',queryable:true,latestDefinition:x.definition,statusDetail:[{status:'READY',queryable:true}]}));
  delete (ready[0] as Partial<typeof ready[number]>).type; // MongoDB may omit the regular Search type.
  const fake=fixture(ready),verified=await runAtlasIndexCommand(command('verify'),env,fake.factory);
  assert.equal(verified.ready,true);assert.equal(verified.indexes[0].current?.type,null);assert.equal(fake.writes,0);
  fake.rows[0].type='vectorSearch';
  assert.equal((await runAtlasIndexCommand(command('verify'),env,fake.factory)).ready,false);
  fake.rows[0].type=undefined;
  fake.rows[1].type=undefined;
  assert.equal((await runAtlasIndexCommand(command('verify'),env,fake.factory)).ready,false);
  fake.rows[1].type='vectorSearch';
  fake.rows[1].statusDetail=[{status:'BUILDING',queryable:true}];
  assert.equal((await runAtlasIndexCommand(command('verify'),env,fake.factory)).ready,false);
  fake.rows[1].statusDetail=[{status:'READY',queryable:true}];fake.rows[1].queryable=false;
  assert.equal((await runAtlasIndexCommand(command('verify'),env,fake.factory)).ready,false);
  fake.rows[1].queryable=true;fake.rows[1].latestDefinition={fields:[]};
  assert.equal((await runAtlasIndexCommand(command('verify'),env,fake.factory)).ready,false);
  const preview=await runAtlasIndexCommand(command('preview'),env,fake.factory);
  await assert.rejects(runAtlasIndexCommand(command('apply',preview.previewHash),env,fake.factory),/differs from the expected definition/);
  assert.equal(fake.writes,0);
});

test('only an explicit matching synthetic Atlas database can be inspected or changed',async()=>{
  const fake=fixture();
  for(const bad of [{...env,MONGODB_DB:'kiara_prod'},{...env,KIARA_V2_RELEASE_SYNTHETIC_DB:'other'},{...env,KIARA_V2_ATLAS_URI:'mongodb://localhost:27017'},{...env,KIARA_V2_ATLAS_URI:uri+'?tls=false'},{...env,KIARA_V2_ATLAS_URI:uri+'?tlsInsecure=true'},{...env,KIARA_V2_ATLAS_URI:uri+'?tlsAllowInvalidCertificates=true'},{...env,KIARA_V2_ATLAS_URI:uri+'?tls=true&TLS=false'},{...env,KIARA_V2_ATLAS_URI:uri+'?ssl=true&tls=true'}])
    await assert.rejects(runAtlasIndexCommand(command('preview'),bad,fake.factory));
  await assert.rejects(runAtlasIndexCommand({phase:'preview',database:'kiara_prod'},env,fake.factory));
  assert.equal(fake.reads,0);assert.equal(fake.writes,0);
  const fallback={...env,MONGODB_URI:uri,KIARA_V2_ATLAS_URI:undefined};
  assert.equal((await runAtlasIndexCommand(command('preview'),fallback,fake.factory)).indexes.length,2);
  assert.throws(()=>parseAtlasIndexCommand(['apply','--database',database]),/preview hash/);
  assert.throws(()=>parseAtlasIndexCommand(['preview','--database',database,'--preview-hash','0'.repeat(64)]),/Only apply/);
});
