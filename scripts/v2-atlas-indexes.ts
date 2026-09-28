import {MongoClient,type Document} from 'mongodb';
import ConnectionString from 'mongodb-connection-string-url';
import {hybridIndexDefinitions,type HybridConfig} from '../src/v2/hybrid';
import {EMBEDDING_POLICY} from '../src/v2/embeddings';
import {digest} from '../src/v2/store';

type Phase='preview'|'apply'|'verify';
type IndexDefinition=ReturnType<typeof hybridIndexDefinitions>[number];
type IndexState={name:string;type?:string;status?:string;queryable?:boolean;latestDefinition?:Document;definition?:Document;statusDetail?:{status?:string;queryable?:boolean}[]};
export interface AtlasIndexInput {phase:Phase;database:string;previewHash?:string}
export interface AtlasIndexAdapter {list():Promise<IndexState[]>;create(index:IndexDefinition):Promise<string>;close():Promise<void>}

const namePattern=/^[A-Za-z0-9_-]{1,64}$/;
const hashPattern=/^[a-f0-9]{64}$/i;

export function parseAtlasIndexCommand(args:string[]):AtlasIndexInput {
  const [phase,...rest]=args;
  if(!['preview','apply','verify'].includes(phase))throw new Error('Usage: v2-atlas-indexes <preview|apply|verify> --database DATABASE [--preview-hash SHA256]');
  const options=new Map<string,string>();
  for(let i=0;i<rest.length;i+=2){const key=rest[i],value=rest[i+1];if(!['--database','--preview-hash'].includes(key)||options.has(key)||!value||value.startsWith('--'))throw new Error('Unknown, duplicate or missing Atlas index option.');options.set(key,value);}
  const database=options.get('--database')||'',previewHash=options.get('--preview-hash');
  if(!namePattern.test(database))throw new Error('Supply one exact database name.');
  if(phase==='apply'&&!hashPattern.test(previewHash||''))throw new Error('Apply requires the SHA-256 preview hash.');
  if(phase!=='apply'&&previewHash)throw new Error('Only apply accepts a preview hash.');
  return {phase:phase as Phase,database,...(previewHash?{previewHash:previewHash.toLowerCase()}:{})};
}

function target(input:AtlasIndexInput,env:NodeJS.ProcessEnv){
  const uri=env.KIARA_V2_ATLAS_URI||env.MONGODB_URI||'',configuredDb=env.MONGODB_DB||'',syntheticDb=env.KIARA_V2_RELEASE_SYNTHETIC_DB||'',releaseDb=env.KIARA_V2_RELEASE_DB||'';
  const synthetic=!!syntheticDb&&input.database===syntheticDb&&/(?:synthetic|sandbox|test)/i.test(syntheticDb);
  const release=!!releaseDb&&input.database===releaseDb&&/^kiara(?:_[a-z0-9]+)*_v2$/.test(releaseDb);
  if(!namePattern.test(input.database)||input.database!==configuredDb||synthetic===release||!!syntheticDb&&!!releaseDb)
    throw new Error('Atlas index operations require one exact configured v2 release or isolated synthetic database.');
  let url:ConnectionString;
  try{url=new ConnectionString(uri);}catch{throw new Error('Configure a TLS-enabled Atlas connection for the selected database.');}
  const options=[...url.searchParams].map(([name,value])=>[name.toLowerCase(),value.toLowerCase()] as const);
  const security=['tls','ssl','tlsinsecure','tlsallowinvalidcertificates','tlsallowinvalidhostnames'];
  const ambiguous=security.some(name=>options.filter(([key])=>key===name).length>1)||options.some(([key])=>key==='tls')&&options.some(([key])=>key==='ssl');
  const insecure=options.some(([key,value])=>['tlsinsecure','tlsallowinvalidcertificates','tlsallowinvalidhostnames'].includes(key)&&!['false','0'].includes(value));
  const tls=options.find(([key])=>key==='tls'||key==='ssl')?.[1];
  const atlasHosts=url.hosts.length>0&&url.hosts.every(host=>{const name=host.replace(/:\d+$/,'').toLowerCase();return name.endsWith('.mongodb.net')&&name!=='mongodb.net';});
  const srv=url.protocol==='mongodb+srv:'&&url.hosts.length===1;
  const standard=url.protocol==='mongodb:'&&tls!==undefined&&['true','1'].includes(tls);
  if(!(srv||standard)||!atlasHosts||url.pathname!=='/'&&url.pathname!==`/${input.database}`||ambiguous||insecure||tls!==undefined&&!['true','1'].includes(tls))
    throw new Error('The index operator requires a TLS-enabled Atlas URI targeting the selected database.');
  if(env.KIARA_V2_RETRIEVAL_MODE!=='atlas')throw new Error('Select Atlas retrieval mode before managing its indexes.');
  const searchIndex=env.KIARA_V2_ATLAS_SEARCH_INDEX||'',vectorIndex=env.KIARA_V2_ATLAS_VECTOR_INDEX||'';
  if(!/^[a-zA-Z0-9_-]{1,100}$/.test(searchIndex)||!/^[a-zA-Z0-9_-]{1,100}$/.test(vectorIndex))throw new Error('Configure both exact Atlas index names.');
  const config:HybridConfig={collection:'v2_search_chunks',searchIndex,vectorIndex,embeddingPolicyHash:digest(EMBEDDING_POLICY),protocol:'kiara-atlas-chunks-1'};
  if(config.searchIndex===config.vectorIndex)throw new Error('Keyword and vector indexes need distinct names.');
  return {uri,database:input.database,collection:config.collection,definitions:hybridIndexDefinitions(config),connectionFingerprint:digest(uri)};
}

function summarize(expected:IndexDefinition[],actual:IndexState[]){
  for(const name of expected.map(x=>x.name))if(actual.filter(x=>x.name===name).length>1)throw new Error(`Atlas reported duplicate index name ${name}.`);
  return expected.map(index=>{
    const row=actual.find(x=>x.name===index.name),definition=row?.latestDefinition||row?.definition;
    // Atlas can omit the type of a regular Search index; vectorSearch must be explicit.
    const observedType=row?.type??(index.type==='search'?'search':undefined);
    const definitionMatches=!!row&&!!definition&&digest(definition)===digest(index.definition)&&observedType===index.type;
    const ready=definitionMatches&&row?.status==='READY'&&row.queryable===true&&(!row.statusDetail||row.statusDetail.length>0&&row.statusDetail.every(x=>x.status==='READY'&&x.queryable===true));
    return {name:index.name,type:index.type,expectedDefinition:index.definition,expectedDefinitionHash:digest(index.definition),current:row?{type:row.type||null,status:row.status||null,queryable:row.queryable===true,definition:definition||null,definitionHash:definition?digest(definition):null,statusDetail:row.statusDetail||null}:null,definitionMatches,ready:!!ready};
  });
}

async function liveAdapter(uri:string,database:string,collection:string):Promise<AtlasIndexAdapter>{
  const client=new MongoClient(uri,{maxPoolSize:2,serverSelectionTimeoutMS:5000,socketTimeoutMS:15000});
  try{await client.connect();}catch(error){await client.close();throw error;}
  const target=client.db(database).collection(collection);
  return {list:async()=>await target.listSearchIndexes().toArray() as IndexState[],create:async index=>target.createSearchIndex(index),close:async()=>client.close()};
}

/** Apply creates only absent indexes; it never updates or drops an existing definition. */
export async function runAtlasIndexCommand(input:AtlasIndexInput,env:NodeJS.ProcessEnv=process.env,adapterFactory:typeof liveAdapter=liveAdapter){
  const selected=target(input,env),adapter=await adapterFactory(selected.uri,selected.database,selected.collection);
  try{
    const current=summarize(selected.definitions,await adapter.list());
    const exact={database:selected.database,collection:selected.collection,connectionFingerprint:selected.connectionFingerprint,indexes:current};
    const previewHash=digest(exact);
    if(input.phase==='apply'&&input.previewHash!==previewHash)throw new Error('Atlas index state, definitions or target changed; preview again.');
    const created:string[]=[];
    if(input.phase==='apply'){
      if(current.some(x=>x.current&&!x.definitionMatches))throw new Error('An existing Atlas index differs from the expected definition; inspect it manually.');
      for(const index of selected.definitions){
        if(current.some(x=>x.name===index.name&&x.current))continue;
        const name=await adapter.create(index);
        if(name!==index.name)throw new Error('Atlas returned an unexpected created index name.');
        created.push(name);
      }
    }
    const observed=input.phase==='apply'?summarize(selected.definitions,await adapter.list()):current;
    return {phase:input.phase,database:selected.database,collection:selected.collection,connectionFingerprint:selected.connectionFingerprint,previewHash,indexes:observed,created,ready:observed.every(x=>x.ready)};
  }finally{await adapter.close();}
}

if(import.meta.url===`file://${process.argv[1]}`){
  runAtlasIndexCommand(parseAtlasIndexCommand(process.argv.slice(2))).then(report=>{process.stdout.write(`${JSON.stringify(report,null,2)}\n`);if(report.phase!=='preview'&&!report.ready)process.exitCode=2;}).catch(error=>{process.stderr.write(`${error instanceof Error?error.message:'Atlas index operation failed.'}\n`);process.exitCode=1;});
}
