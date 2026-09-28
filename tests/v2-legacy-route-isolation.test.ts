import test from 'node:test';
import assert from 'node:assert/strict';
import {GET,POST} from '../src/app/api/[...path]/route';

const origin='https://kiara.example';
const context=(path:string)=>({params:Promise.resolve({path:path.split('/')})});

test('v2 deployment rejects every legacy route before legacy state or authentication',async()=>{
  const before={...process.env};
  try{
    process.env.KIARA_AUTH_MODE='hosted_password';
    for(const config of [
      {KIARA_V2_AUTH_MODE:'oidc',KIARA_V2_STORE_MODE:undefined,MONGODB_DB:'legacy'},
      {KIARA_V2_AUTH_MODE:undefined,KIARA_V2_STORE_MODE:undefined,MONGODB_DB:'kiara_v2'},
      {KIARA_V2_AUTH_MODE:undefined,KIARA_V2_STORE_MODE:'normalized',MONGODB_DB:'synthetic'},
    ]){
      for(const [key,value] of Object.entries(config)){
        if(value===undefined)delete process.env[key];else process.env[key]=value;
      }
      for(const path of ['health','workspace','readiness','sources/example']){
        const response=await GET(new Request(`${origin}/api/${path}`),context(path));
        assert.equal(response.status,404);
        assert.equal((await response.json()).error.code,'LEGACY_API_DISABLED');
      }
      for(const path of ['login','webhooks/resend','events']){
        const response=await POST(new Request(`${origin}/api/${path}`,{method:'POST',headers:{origin,'content-type':'application/json'},body:'{}'}),context(path));
        assert.equal(response.status,404);
        assert.equal((await response.json()).error.code,'LEGACY_API_DISABLED');
      }
    }
  }finally{
    for(const key of Object.keys(process.env))if(!(key in before))delete process.env[key];
    Object.assign(process.env,before);
  }
});
