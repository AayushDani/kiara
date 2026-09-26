/** Protected retries apply only to an explicit provider rate rejection, never billing or uncertain requests. */
export const RATE_LIMIT_RETRY_POLICY=Object.freeze({max_retries:2,max_delay_ms:30_000,min_delay_ms:1_000,min_dispatch_window_ms:5_000});
function header(error:any,name:string):string|null{
  const value=typeof error?.headers?.get==='function'?error.headers.get(name):error?.headers?.[name];
  return typeof value==='string'&&value.length<=100?value:null;
}
function seconds(value:string|null):number|null{
  if(value===null||!/^\d+(?:\.\d+)?$/.test(value.trim()))return null;
  const parsed=Number(value)*1000;return Number.isFinite(parsed)?parsed:null;
}
/** Extract numbers only; provider messages can contain organization IDs or other sensitive text. */
export function providerRateDiagnostics(error:unknown):Record<string,number>{
  const e=error as any,result:Record<string,number>={};
  const retain=(key:string,value:number)=>{if(Number.isFinite(value)&&value>=0&&value<=1e12)result[key]=value;};
  const message=typeof (e?.error?.message??e?.message)==='string'?(e?.error?.message??e?.message).slice(0,12000):'';
  for(const label of ['limit','used','requested']){const match=message.match(new RegExp('\\b'+label+'\\s*:\\s*(\\d+(?:\\.\\d+)?)','i'));if(match)retain(`message_${label}`,Number(match[1]));}
  const retry=message.match(/\btry again in\s+(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|seconds?)\b/i);if(retry)retain('message_retry_after_ms',Number(retry[1])*(retry[2].toLowerCase().startsWith('m')?1:1000));
  for(const kind of ['tokens','requests'])for(const measure of ['limit','remaining']){const raw=header(e,`x-ratelimit-${measure}-${kind}`);if(raw&&/^\d+(?:\.\d+)?$/.test(raw))retain(`header_${measure}_${kind}`,Number(raw));}
  for(const kind of ['tokens','requests']){
    const raw=header(e,`x-ratelimit-reset-${kind}`);
    if(raw&&/^(?:\d+(?:\.\d+)?(?:ms|s|m|h))+$/.test(raw)){let total=0;for(const match of raw.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g))total+=Number(match[1])*({ms:1,s:1000,m:60000,h:3600000}[match[2]]!);retain(`header_reset_${kind}_ms`,total);}
  }
  const milliseconds=seconds(header(e,'retry-after-ms'));if(milliseconds!==null)retain('header_retry_after_ms',milliseconds/1000);else{const delay=seconds(header(e,'retry-after'));if(delay!==null)retain('header_retry_after_ms',delay);}
  return result;
}
export function rateLimitBackoff(error:unknown,retries:number,deadline_at:string,at=Date.now()):{delay_ms:number;source:'retry-after-ms'|'retry-after'|'exponential';retry_number:number}|null{
  const e=error as any;
  if(e?.status!==429||(e?.code||e?.error?.code)!=='rate_limit_exceeded'||retries>=RATE_LIMIT_RETRY_POLICY.max_retries)return null;
  let requested:number|null=null,source:'retry-after-ms'|'retry-after'|'exponential'='exponential';
  const milliseconds=seconds(header(e,'retry-after-ms'));
  if(milliseconds!==null){requested=milliseconds/1000;source='retry-after-ms';}
  else{
    const raw=header(e,'retry-after');
    requested=seconds(raw);
    if(requested===null&&raw&&/^[A-Z][a-z]{2}, .+ GMT$/.test(raw)){const target=Date.parse(raw);if(Number.isFinite(target))requested=Math.max(0,target-at);}
    if(requested!==null)source='retry-after';
  }
  const delay_ms=Math.max(RATE_LIMIT_RETRY_POLICY.min_delay_ms,Math.min(RATE_LIMIT_RETRY_POLICY.max_delay_ms,requested??15_000*2**retries));
  if(!Number.isFinite(Date.parse(deadline_at))||Date.parse(deadline_at)-at<=delay_ms+RATE_LIMIT_RETRY_POLICY.min_dispatch_window_ms)return null;
  return {delay_ms,source,retry_number:retries+1};
}
