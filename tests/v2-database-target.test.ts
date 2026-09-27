import test from 'node:test';
import assert from 'node:assert/strict';
import {v2DatabaseName} from '../src/v2/database-target';

test('hosted v2 fails closed before using a legacy or implicit Mongo database',()=>{
  const prior={vercel:process.env.VERCEL,database:process.env.MONGODB_DB};
  try{
    process.env.VERCEL='1';
    for(const name of [undefined,'kiara','kiara_demo']){
      if(name===undefined)delete process.env.MONGODB_DB;else process.env.MONGODB_DB=name;
      assert.throws(()=>v2DatabaseName(),{code:'V2_DATABASE_TARGET'});
    }
    process.env.MONGODB_DB='kiara_v2';
    assert.equal(v2DatabaseName(),'kiara_v2');
  }finally{
    if(prior.vercel===undefined)delete process.env.VERCEL;else process.env.VERCEL=prior.vercel;
    if(prior.database===undefined)delete process.env.MONGODB_DB;else process.env.MONGODB_DB=prior.database;
  }
});
