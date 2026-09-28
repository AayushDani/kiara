import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTestPack,parseSeedInput,seedPlan} from '../scripts/v2-test-seed';
import {emptyWorkspace} from '../src/v2/store';

const tenant='synthetic-test-preview',actor='test-owner',binding={key:'a'.repeat(64),version:1};
function empty(){const s=emptyWorkspace(tenant);s.memberships.push({actorId:actor,roles:['member','business_owner','fact_owner'],version:1,expiresAt:null,revokedAt:null,matterIds:null,entityIds:null});s.version=1;return s;}

test('Test pack preview binds exact source bytes, source hashes and pending command set',async()=>{
 const pack=await loadTestPack(),plan=seedPlan(empty(),actor,pack,'atlas-target',binding);
 assert.equal(pack.documents.length,15);
 assert.equal(plan.documents.length,15);
 assert.equal(plan.steps.filter(step=>step.key.startsWith('document:')).length,15);
 assert.equal(plan.steps.filter(step=>step.key.startsWith('matter:')).length,2);
 assert.equal(plan.steps.filter(step=>step.key.startsWith('fact:')).length,3);
 assert.equal(plan.legalSourceState,'not_intaked_or_reviewed');
 assert.equal(plan.externalEffectsAuthorized,false);
 assert.equal(plan.previewHash.length,64);
 const changed=empty();changed.version++;
 assert.notEqual(seedPlan(changed,actor,pack,'atlas-target',binding).previewHash,plan.previewHash);
});

test('Test seed refuses a mixed workspace and malformed apply',async()=>{
 const pack=await loadTestPack(),s=empty();
 s.companyName='Another customer';
 assert.throws(()=>seedPlan(s,actor,pack,'atlas-target',binding),/clean synthetic Test/);
 assert.throws(()=>parseSeedInput(['apply',tenant,actor,'1']),/Usage/);
 assert.throws(()=>parseSeedInput(['preview','synthetic-kiara-preview',actor,'1']),/Usage/);
});
