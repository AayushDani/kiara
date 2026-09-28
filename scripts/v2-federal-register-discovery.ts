/** Read-only operator research aid; it does not stage or verify a legal source. */
import {discoverFederalRegisterCfrPart} from '../src/v2/legal-reference-federal-register';
import {V2Error} from '../src/v2/contracts';

const [titleFlag,titleValue,partFlag,partValue,...extra]=process.argv.slice(2);
if(titleFlag!=='--title'||partFlag!=='--part'||!titleValue||!partValue||extra.length||!/^\d{1,2}$/.test(titleValue)||!/^\d{1,4}$/.test(partValue)){
 console.error('Usage: node --import tsx scripts/v2-federal-register-discovery.ts --title N --part N');
 process.exitCode=2;
}else{
 try{console.log(JSON.stringify(await discoverFederalRegisterCfrPart(Number(titleValue),Number(partValue)),null,2));}
 catch(error){console.error(JSON.stringify({code:error instanceof V2Error?error.code:'FR_READ_FAILED',message:error instanceof V2Error?error.message:'Federal Register discovery failed.'}));process.exitCode=1;}
}
