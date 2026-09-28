/** Finite executable strategy catalog. No model call, permissions or learning label is inferred here. */
export type StrategyKey='exact_clause_reference'|'preserve_material_values';
export interface RankingInput {kind:'ranking';query:string;items:{id:string;title:string;body:string}[]}
export interface FidelityInput {kind:'fidelity';instruction:string;before:string;after:string}
export type StrategyInput=RankingInput|FidelityInput;
export function lexicalScore(query:string,title:string,body:string){const terms=[...new Set(query.toLowerCase().match(/[\p{L}\p{N}_-]{3,}/gu)||[])];return terms.reduce((n,t)=>n+(title.toLowerCase().includes(t)?5:0)+(body.toLowerCase().includes(t)?1:0),0);}
export function clauseReferenceBoost(query:string,body:string){const references=[...query.matchAll(/(?:\bsection|\bclause|§)\s*(\d+(?:\.\d+)*(?:\([a-z0-9]+\))?)/gi)].map(x=>x[1]);return references.some(id=>{const escaped=id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');return new RegExp(`^\\s*(?:#{1,6}\\s*)?(?:(?:section|clause|§)\\s*)?${escaped}(?=[\\s).:]|$)`,'im').test(body);})?30:0;}
export function meaningPreservingInstruction(instruction:string){return /\b(shorten|shorter|clearer|simplify|rephrase)\b/i.test(instruction)&&!/\b(change|replace|increase|decrease|instead|amend)\b/i.test(instruction);}
export function materialTokens(body:string){return [...new Set(body.match(/\b\d+(?:[.,:/-]\d+)*(?:%)?/g)||[])].sort();}
export function preservesMaterialValues(input:FidelityInput){if(!meaningPreservingInstruction(input.instruction))return true;const after=new Set(materialTokens(input.after));return materialTokens(input.before).every(token=>after.has(token));}
export function strategyOutput(input:StrategyInput,candidate:boolean):string|boolean {if(input.kind==='fidelity')return !candidate||preservesMaterialValues(input);return [...input.items].sort((a,b)=>(lexicalScore(input.query,b.title,b.body)+(candidate?clauseReferenceBoost(input.query,b.body):0))-(lexicalScore(input.query,a.title,a.body)+(candidate?clauseReferenceBoost(input.query,a.body):0))||a.id.localeCompare(b.id))[0]?.id||'';}
