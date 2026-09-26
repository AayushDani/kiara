import {AppError} from '../server/contracts';
export interface HarnessConfig {schema_version:1;retrieval:{prefetch:{declared_ca_resident_ccpa_bundle:boolean;declared_ca_resident_company_facts:boolean}}}
export interface PatchOperation {op:'test'|'replace';path:string;value:boolean}
export const paths=['/retrieval/prefetch/declared_ca_resident_ccpa_bundle','/retrieval/prefetch/declared_ca_resident_company_facts'];
export const BASE_CONFIG:HarnessConfig={schema_version:1,retrieval:{prefetch:{declared_ca_resident_ccpa_bundle:false,declared_ca_resident_company_facts:false}}};
export const PREFETCH_PATCH:PatchOperation[]=paths.flatMap(path=>[{op:'test' as const,path,value:false},{op:'replace' as const,path,value:true}]);
export function validateHarnessPatch(input:unknown,base:HarnessConfig=BASE_CONFIG):HarnessConfig {
  if(!Array.isArray(input)||input.length!==4||Buffer.byteLength(JSON.stringify(input))>2048)throw new AppError('HARNESS_PATCH_INVALID','Exactly two guarded prefetch changes are allowed.');
  const seen=new Set<string>();const result=structuredClone(base);
  for(const op of input){
    if(!op||typeof op!=='object'||Object.keys(op).sort().join(',')!=='op,path,value'||!['test','replace'].includes(op.op)||!paths.includes(op.path)||typeof op.value!=='boolean')throw new AppError('PROTECTED_HARNESS_PATH','Only canonical prefetch flag paths are mutable.');
    const key=op.op+':'+op.path;if(seen.has(key))throw new AppError('HARNESS_PATCH_DUPLICATE','A path may be tested and replaced exactly once.');seen.add(key);
    const name=op.path.split('/').at(-1) as keyof HarnessConfig['retrieval']['prefetch'];
    if(op.op==='test'){if(op.value!==false||result.retrieval.prefetch[name]!==false)throw new AppError('HARNESS_PATCH_TEST_FAILED','Prefetch change must test false before replacement.');}
    else{if(!seen.has('test:'+op.path)||op.value!==true||result.retrieval.prefetch[name]!==false)throw new AppError('HARNESS_PATCH_TRANSITION','Only a tested false-to-true transition is allowed.');result.retrieval.prefetch[name]=true;}
  }
  for(const p of paths)if(!seen.has('test:'+p)||!seen.has('replace:'+p))throw new AppError('HARNESS_PATCH_INCOMPLETE','Both guarded selectors are required.');return result;
}
