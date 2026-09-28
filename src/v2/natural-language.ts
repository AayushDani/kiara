/** Conservative parsing makes a reviewable proposal, never a confirmed fact or approval. */
export interface ParsedCorrection {predicate:string;value:string;practice:'planned'|'live'|'unknown';confidence:'explicit';subjectPhrase:string}
const ambiguous=/^(?:that|this|it|they|them|those|the feature|the vendor|the contract)$/i;
const predicate=(value:string)=>value.toLowerCase().trim().replace(/['’]s\b/g,'').replace(/[^\p{L}\p{N}]+/gu,'_').replace(/^_+|_+$/g,'').slice(0,120);
const strip=(value:string)=>value.trim().replace(/[.!?]+$/,'').trim();
/** Only an explicit named subject and predicate/value assertion is structured automatically. */
export function parseFactualCorrection(input:string):ParsedCorrection|null {
 if(input.includes('?'))return null;
 const text=strip(input.replace(/^\s*(?:actually|correction|to clarify|for clarity)[,:]?\s*/i,''));
 if(text.length<7||text.length>1000||/\b(?:what if|maybe|suppose|hypothetically|could|might|would)\b/i.test(text))return null;
 const match=text.match(/^(?:our\s+)?([\p{L}\p{N}][\p{L}\p{N}\s'’.-]{1,120}?)\s+(isn['’]t|aren['’]t|is|are|was|were)\s+(.{1,500})$/iu);
 if(!match)return null;
 const subjectPhrase=strip(match[1]),value=/n['’]t$/i.test(match[2])?`not ${strip(match[3])}`:strip(match[3]);
 if(ambiguous.test(subjectPhrase)||/^(?:what|when|where|why|who|whose|which|how)\b/i.test(subjectPhrase)||!value||/^(?:that|this|it|yes|no)$/i.test(value)||/\b(?:please|should|must|approve|send|publish)\b/i.test(value))return null;
 const key=predicate(subjectPhrase);if(!key||key.startsWith('relationship_'))return null;
 const negatedLive=/(?:\bnot\b|\bis\s+not\b|\bare\s+not\b|\bisn['’]t\b|\baren['’]t\b)\s+(?:yet\s+)?(?:in\s+production|deployed|live)\b/i.test(value);
 const practice:ParsedCorrection['practice']=/\b(?:staging|test|pilot|planned|proposed|sandbox)\b/i.test(value)?'planned':negatedLive?'unknown':/\b(?:production|deployed|live|currently operating)\b/i.test(value)?'live':'unknown';
 return {predicate:/\b(?:staging|deployed|production|live)\b/i.test(value)&&!key.includes('deployment')?`${key}_deployment_status`:key,value,practice,confidence:'explicit',subjectPhrase};
}
export type ParsedPreference={key:'response_length';value:string;target:'personal'};
export function parsePersonalPreference(input:string):ParsedPreference|null {
 const text=strip(input);if(!/\b(?:please|i prefer|for me|my answers|my responses|give me the)\b/i.test(text)||!/\b(?:answers?|responses?|replies?|explain|explanations?|tell me|answer)\b/i.test(text)||/\b(?:draft|document|nda|agreement|clause|contract|email|notice)\b/i.test(text))return null;
 if(/\b(?:short|brief|concise|succinct|bottom line first|summary first)\b/i.test(text))return {key:'response_length',value:'short answer first',target:'personal'};
 if(/\b(?:detailed|more detail|thorough|explain more)\b/i.test(text))return {key:'response_length',value:'detailed answer',target:'personal'};
 return null;
}
