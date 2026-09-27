import test from 'node:test';
import assert from 'node:assert/strict';
import {v2DatabaseName} from '../src/v2/database-target';

test('hosted web and worker modes fail closed before using a legacy or implicit Mongo database',()=>{
  const signals=['VERCEL','NODE_ENV','KIARA_V2_AUTH_MODE','KIARA_V2_ORCHESTRATION_MODE','KIARA_V2_WORKER_HOST'] as const;
  const prior=Object.fromEntries([...signals,'MONGODB_DB'].map(key=>[key,process.env[key]]));
  try{
    for(const signal of signals)delete process.env[signal];
    process.env.MONGODB_DB='kiara_qualification_synthetic';
    assert.equal(v2DatabaseName(),'kiara_qualification_synthetic');
    for(const [signal,value] of [['VERCEL','1'],['NODE_ENV','production'],['KIARA_V2_AUTH_MODE','oidc'],['KIARA_V2_ORCHESTRATION_MODE','temporal'],['KIARA_V2_WORKER_HOST','render']] as const){
      Reflect.set(process.env,signal,value);
      for(const name of [undefined,'kiara','kiara_demo','kiara_qualification_synthetic']){
        if(name===undefined)delete process.env.MONGODB_DB;else process.env.MONGODB_DB=name;
        assert.throws(()=>v2DatabaseName(),{code:'V2_DATABASE_TARGET'},`${signal} must reject ${name||'implicit database'}`);
      }
      process.env.MONGODB_DB='kiara_v2';
      assert.equal(v2DatabaseName(),'kiara_v2');
      delete process.env[signal];
    }
  }finally{
    for(const key of [...signals,'MONGODB_DB'])if(prior[key]===undefined)delete process.env[key];else Reflect.set(process.env,key,prior[key]);
  }
});
