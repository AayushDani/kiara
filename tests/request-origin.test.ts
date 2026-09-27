import test from 'node:test';
import assert from 'node:assert/strict';
import {requestOriginMatches} from '../src/server/request-origin';
test('F16 numeric local Host reconciles framework URL normalization without trusting forwarded hosts',()=>{
 const normalized=(headers:Record<string,string>)=>new Request('http://localhost:3091/api/session',{headers});
 assert.equal(requestOriginMatches(normalized({origin:'http://127.0.0.1:3091',host:'127.0.0.1:3091'}),true),true);
 assert.equal(requestOriginMatches(normalized({origin:'http://127.0.0.1:3091',host:'127.0.0.1:3091'}),false),false);
 for(const headers of ([{origin:'http://127.0.0.1:3091',host:'localhost:3091','x-forwarded-host':'127.0.0.1:3091'},{origin:'http://evil.example:3091',host:'evil.example:3091'},{origin:'http://127.0.0.1:4000',host:'127.0.0.1:4000'},{origin:'https://127.0.0.1:3091',host:'127.0.0.1:3091'},{origin:'null',host:'127.0.0.1:3091'}] as Record<string,string>[]))assert.equal(requestOriginMatches(normalized(headers),true),false);
 assert.equal(requestOriginMatches(new Request('https://kiara.example/api/session',{headers:{origin:'https://kiara.example'}})),true);
 assert.equal(requestOriginMatches(new Request('https://kiara.example/api/session',{headers:{origin:'https://evil.example',host:'evil.example','x-forwarded-host':'evil.example'}}),true),false);
});
