/** Read-only verification of selected encrypted originals in an isolated restored database. */
import {createHash} from 'node:crypto';
import {readFile,stat} from 'node:fs/promises';
import {readMongoOriginal,closeMongoOriginalStore} from '../src/v2/mongo-originals';
import {V2Error} from '../src/v2/contracts';
import type {OriginalReference} from '../src/v2/objects';

type Expectation='readable'|'deleted';
interface Check {reference:OriginalReference;expected:Expectation}
export interface RestoreManifest {tenantId:string;checks:Check[]}
interface RestoreTarget {database:string;sourceDatabase:string;manifestPath:string}
const sha=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
const dbName=/^[A-Za-z0-9_-]{1,64}$/;

export function parseRestoreCommand(args:string[]):RestoreTarget {
 if(args.length!==6)throw new Error('Usage: v2-original-restore-verify --database kiara_recovery_NAME --source-database SOURCE_DB --manifest PATH');
 const options=new Map<string,string>();
 for(let i=0;i<args.length;i+=2){const name=args[i],value=args[i+1];if(!['--database','--source-database','--manifest'].includes(name)||options.has(name)||!value||value.startsWith('--'))throw new Error('Supply the exact recovery database, source database and manifest path.');options.set(name,value);}
 return {database:options.get('--database')||'',sourceDatabase:options.get('--source-database')||'',manifestPath:options.get('--manifest')||''};
}

export function validateRestoreTarget(target:RestoreTarget,env:NodeJS.ProcessEnv){
 if(!/^kiara_recovery_[A-Za-z0-9_-]{1,48}$/.test(target.database)||!dbName.test(target.sourceDatabase)||target.database===target.sourceDatabase||env.MONGODB_DB!==target.database)throw new Error('Select an exact isolated recovery database different from the source database.');
 if(!/^[a-f0-9]{64}$/i.test(env.KIARA_ORIGINALS_KEY||''))throw new Error('Configure the matching escrowed original encryption key.');
 let url:URL;try{url=new URL(env.MONGODB_URI||'');}catch{throw new Error('Configure a TLS-enabled Atlas URI for the restored database.');}
 const entries=[...url.searchParams].map(([name,value])=>[name.toLowerCase(),value.toLowerCase()] as const);
 const tls=entries.find(([name])=>name==='tls'||name==='ssl')?.[1];
 const insecure=entries.some(([name,value])=>['tlsinsecure','tlsallowinvalidcertificates','tlsallowinvalidhostnames'].includes(name)&&!['false','0'].includes(value));
 const ambiguous=['tls','ssl','tlsinsecure','tlsallowinvalidcertificates','tlsallowinvalidhostnames'].some(name=>entries.filter(([key])=>key===name).length>1)||entries.some(([name])=>name==='tls')&&entries.some(([name])=>name==='ssl');
 if(url.protocol!=='mongodb+srv:'||!url.hostname.endsWith('.mongodb.net')||url.hostname==='mongodb.net'||url.pathname!=='/'&&url.pathname!==`/${target.database}`||insecure||ambiguous||tls!==undefined&&!['true','1'].includes(tls))throw new Error('The recovery verifier requires a TLS-enabled Atlas SRV URI targeting only the recovery database.');
 return {database:target.database,sourceDatabase:target.sourceDatabase,connectionFingerprint:sha(env.MONGODB_URI!)};
}

export function validateRestoreManifest(value:unknown):RestoreManifest {
 if(!value||typeof value!=='object')throw new Error('Restore manifest must be an object.');
 const row=value as Partial<RestoreManifest>;
 if(typeof row.tenantId!=='string'||!row.tenantId||row.tenantId.length>200||!Array.isArray(row.checks)||row.checks.length<2||row.checks.length>20)throw new Error('Supply a tenant and 2–20 exact original checks.');
 const tenantHash=sha(row.tenantId),expected=new Set<string>(),seen=new Set<string>();
 for(const check of row.checks){
  const ref=check?.reference;
  if(!['readable','deleted'].includes(check?.expected)||!ref||ref.storage!=='mongo_encrypted'||ref.encryption!=='aes-256-gcm'||!/^[a-f0-9]{64}$/.test(ref.sha256)||!/^[a-f0-9]{16}$/.test(ref.keyId)||!Number.isSafeInteger(ref.bytes)||ref.bytes<0||ref.bytes>20_000_000||ref.versionId!==undefined||ref.key!==`${tenantHash}/${ref.sha256}/${ref.keyId}`||seen.has(ref.key))throw new Error('Restore manifest has an invalid, duplicate or cross-tenant original reference.');
  expected.add(check.expected);seen.add(ref.key);
 }
 if(!expected.has('readable')||!expected.has('deleted'))throw new Error('Include a retained original and a previously deleted original to check its fence.');
 return row as RestoreManifest;
}

/** No source text or ciphertext is returned. A missing deletion fence fails the drill. */
export async function verifyRestoredOriginals(target:RestoreTarget,manifest:RestoreManifest,env:NodeJS.ProcessEnv=process.env,reader:typeof readMongoOriginal=readMongoOriginal){
 const selected=validateRestoreTarget(target,env),verified=validateRestoreManifest(manifest);
 const results=[];
 for(const check of verified.checks){
  const referenceHash=sha(check.reference.key);
  if(check.expected==='deleted'){
   try{await reader(verified.tenantId,check.reference);}catch(error){if(error instanceof V2Error&&error.code==='ORIGINAL_DELETED'){results.push({referenceHash,expected:'deleted',verified:true});continue;}throw error;}
   throw new Error('A previously deleted original was readable in the restored database.');
  }
  const bytes=await reader(verified.tenantId,check.reference);
  if(bytes.length!==check.reference.bytes||sha(bytes)!==check.reference.sha256)throw new Error('Restored original bytes did not match the selected reference.');
  results.push({referenceHash,expected:'readable',verified:true,bytes:bytes.length});
 }
 return {...selected,tenantHash:sha(verified.tenantId),manifestHash:sha(JSON.stringify(verified)),checks:results,verified:true};
}

if(import.meta.url===`file://${process.argv[1]}`){
 try{
  const target=parseRestoreCommand(process.argv.slice(2));validateRestoreTarget(target,process.env);
  const file=await stat(target.manifestPath);if(!file.isFile()||file.size>65536)throw new Error('Restore manifest must be a file of at most 64 KiB.');
  const manifest=validateRestoreManifest(JSON.parse(await readFile(target.manifestPath,'utf8')));
  const result=await verifyRestoredOriginals(target,manifest);
  process.stdout.write(`${JSON.stringify(result,null,2)}\n`);
 }catch(error){process.stderr.write(`${error instanceof V2Error?error.code:error instanceof SyntaxError?'Restore manifest is invalid JSON.':'Restore verification failed; inspect the selected recovery database and manifest.'}\n`);process.exitCode=1;}
 finally{await closeMongoOriginalStore();}
}
