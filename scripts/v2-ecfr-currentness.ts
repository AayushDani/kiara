/** Read-only operator research aid; it does not stage a legal source. */
import {inspectEcfrTitleCurrentness} from '../src/v2/legal-reference-ecfr';
import {V2Error} from '../src/v2/contracts';

const [option,value,...extra]=process.argv.slice(2);
if(option!=='--title'||!value||extra.length||!/^[0-9]{1,2}$/.test(value)){
 console.error('Usage: node --import tsx scripts/v2-ecfr-currentness.ts --title N');
 process.exitCode=2;
}else{
 try{console.log(JSON.stringify(await inspectEcfrTitleCurrentness(Number(value)),null,2));}
 catch(error){console.error(JSON.stringify({code:error instanceof V2Error?error.code:'ECFR_READ_FAILED',message:error instanceof V2Error?error.message:'eCFR read failed.'}));process.exitCode=1;}
}
