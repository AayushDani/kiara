import test from 'node:test';
import assert from 'node:assert/strict';
import {matterSignInReturnTo,requestedMatterId} from '../../src/ui/v2/matter-deep-link';

test('matter deep link accepts one opaque ID and preserves it through bounded organization sign-in',()=>{
 const id='123e4567-e89b-12d3-a456-426614174000';
 assert.equal(requestedMatterId(`?matter=${id}`),id);
 const signIn=new URL(matterSignInReturnTo(id),'https://kiara.example.test');
 assert.equal(signIn.pathname,'/api/v2/auth/start');assert.equal(signIn.searchParams.get('returnTo'),`/?matter=${id}`);
 for(const search of ['?matter=','?matter=%2F%2Fevil.example','?matter=a&matter=b','?matter=a&next=b','?other=a'])assert.equal(requestedMatterId(search),null);
});
