/** Deterministic structure assists retrieval; it does not interpret contractual applicability. */
export const SOURCE_STRUCTURE_VERSION='clauses-definitions-context-v1';
export interface SourceChunk {offset:number;end:number;text:string;kind:'heading'|'clause'|'definition'|'table'|'schedule'|'paragraph';label:string|null;parentOffset:number|null;definedTerms:string[];references:string[];structureVersion:typeof SOURCE_STRUCTURE_VERSION}
const words=(text:string)=>[...new Set(text.toLowerCase().match(/[\p{L}\p{N}_-]{3,}/gu)||[])];
function heading(line:string):{label:string;kind:'heading'|'schedule';level:number}|null {
 const value=line.trim();if(value.length>160)return null;
 const markdown=value.match(/^(#{1,6})\s+(.+)$/);if(markdown)return {label:markdown[2],kind:/^(schedule|exhibit|appendix)\b/i.test(markdown[2])?'schedule':'heading',level:markdown[1].length};
 if(/^(schedule|exhibit|appendix)\s+(?:[A-Z]|\d+)(?:\s*[-:.]\s*.*|\s+[A-Z][^.?!]*)?$/i.test(value))return {label:value,kind:'schedule',level:1};
 if(/^(?:\d+(?:\.\d+)*[.)]?\s+)?(?:definitions?|interpretation|scope|exceptions?|notices?|limitations?|data processing|subprocessors?|term and termination|liability|indemnification)$/i.test(value))return {label:value,kind:'heading',level:(value.match(/^\d+(?:\.\d+)*/)?.[0].split('.').length||1)};
 if(/^(?:section|article)\s+[\dIVXLC]+(?:\.\d+)*(?:\s*[:.-]\s*[^.?!]+)?$/i.test(value))return {label:value,kind:'heading',level:(value.match(/\d+(?:\.\d+)*/)?.[0].split('.').length||1)};
 return null;
}
function references(text:string){return [...new Set([...text.matchAll(/\b(section|clause|article|schedule|exhibit|appendix)\s+(\d+(?:\.\d+)*|[A-Z])\b/gi)].map(m=>`${m[1].toLowerCase()}:${m[2].toLowerCase()}`))];}
function sectionLabel(text:string){text=text.replace(/^\s*#{1,6}\s+/,'');const named=text.match(/^\s*(section|clause|article|schedule|exhibit|appendix)\s+(\d+(?:\.\d+)*|[A-Z])\b/i);if(named)return `${named[1].toLowerCase()}:${named[2].toLowerCase()}`;const number=text.match(/^\s*(\d+(?:\.\d+)*)(?:[.)]|\s)\s*\S/);return number?`section:${number[1]}`:null;}
function definitions(text:string){return [...new Set([...text.matchAll(/["“]([^"”\n]{1,80})["”]\s+(?:means|shall mean|includes)\b/gi)].map(m=>m[1]))];}
function segmentEnd(text:string,start:number,max:number){let limit=Math.min(text.length,start+max);if(limit===text.length)return limit;if(/[\uD800-\uDBFF]/.test(text[limit-1])&&/[\uDC00-\uDFFF]/.test(text[limit]))limit--;const window=text.slice(start,limit);let stop=0;for(const m of window.matchAll(/(?:[.;][ \t]+|\r?\n)/g)){const end=m.index+m[0].length;if(end>=max/2)stop=end;}return stop?start+stop:limit;}
/** Every quote and offset is a slice of the original JS string (UTF-16 code units). */
export function structuredSourceChunks(body:string,maxChars=2400):SourceChunk[]{
 if(!Number.isSafeInteger(maxChars)||maxChars<200||maxChars>10000)throw new Error('Unsupported source chunk bound');
 const lines=[...body.matchAll(/[^\r\n]*(?:\r?\n|$)/g)].filter(m=>m[0].length).map(m=>({start:m.index,end:m.index+m[0].length,text:m[0].replace(/\r?\n$/,'')}));
 const units:{start:number;end:number;parentOffset:number|null;heading:ReturnType<typeof heading>}[]=[];let start:number|null=null,end=0,parent:number|null=null;const stack:{offset:number;level:number}[]=[];
 const flush=()=>{if(start!==null&&body.slice(start,end).trim()){units.push({start,end,parentOffset:parent,heading:null});start=null;}};
 for(const line of lines){const h=heading(line.text),numbered=/^\s*\d+(?:\.\d+)*[.)]?\s+\S/.test(line.text);if(h){flush();while(stack.length&&stack.at(-1)!.level>=h.level)stack.pop();units.push({start:line.start,end:line.end,parentOffset:stack.at(-1)?.offset??null,heading:h});stack.push({offset:line.start,level:h.level});parent=line.start;continue;}if(!line.text.trim()){flush();continue;}if(numbered)flush();if(start===null)start=line.start;end=line.end;}flush();
 const result:SourceChunk[]=[];
 for(const unit of units){let at=unit.start;while(at<unit.end){const end=Math.min(unit.end,segmentEnd(body,at,maxChars)),text=body.slice(at,end),definedTerms=definitions(text),table=text.split(/\r?\n/).some(line=>(line.match(/\|/g)||[]).length>=2||line.includes('\t'));
  result.push({offset:at,end,text,kind:unit.heading?.kind||(definedTerms.length?'definition':table?'table':sectionLabel(text)?'clause':'paragraph'),label:unit.heading?.label||sectionLabel(text),parentOffset:at===unit.start?unit.parentOffset:unit.start,definedTerms,references:references(text),structureVersion:SOURCE_STRUCTURE_VERSION});at=end;
 }}
 return result;
}
function containsTerm(text:string,term:string){const escape=term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');return new RegExp(`(^|[^\\p{L}\\p{N}_])${escape}($|[^\\p{L}\\p{N}_])`,'iu').test(text);}
/** Parent headings, exact in-document cross-references and term definitions stay separate cited excerpts. */
export function expandSourceContext(chunks:SourceChunk[],selectedOffsets:number[],maxChunks=8):{chunks:SourceChunk[];omittedContext:boolean}{
 if(!Number.isSafeInteger(maxChunks)||maxChunks<1||maxChunks>32)throw new Error('Unsupported context bound');
 const selected=[...new Set(selectedOffsets)].map(offset=>chunks.find(c=>c.offset===offset)).filter((x):x is SourceChunk=>!!x),result=selected.slice(0,maxChunks),queue=[...result];let omittedContext=selected.length>maxChunks;
 const include=(candidate:SourceChunk|undefined)=>{if(!candidate||result.some(c=>c.offset===candidate.offset))return;if(result.length>=maxChunks){omittedContext=true;return;}result.push(candidate);queue.push(candidate);};
 for(let i=0;i<queue.length&&i<maxChunks;i++){
  const chunk=queue[i];if(chunk.parentOffset!==null)include(chunks.find(c=>c.offset===chunk.parentOffset));
  if(chunk.kind==='heading'||chunk.kind==='schedule'){const children=chunks.filter(c=>c.parentOffset===chunk.offset);for(const child of children.slice(0,2))include(child);if(children.length>2)omittedContext=true;}
  for(const c of chunks){if(c.definedTerms.some(term=>containsTerm(chunk.text,term)))include(c);const label=sectionLabel(c.text);if(label&&chunk.references.some(ref=>ref===label||ref.replace(/^clause:/,'section:')===label))include(c);}
  // Exceptions are retrieval hints only; adjacency or a shared parent does not prove applicability.
  for(let j=0;j<chunks.length;j++){const c=chunks[j];if(c.kind==='heading'&&/exception/i.test(c.label||'')&&(c.parentOffset===chunk.parentOffset||c.parentOffset===chunk.offset)){include(c);if(chunks[j+1]?.parentOffset===c.offset)include(chunks[j+1]);}}
 }
 return {chunks:result.slice(0,maxChunks),omittedContext:omittedContext||selected.length>maxChunks};
}
export function rankSourceChunks(body:string,question:string,primaryLimit=2,totalLimit=8){const chunks=structuredSourceChunks(body),terms=words(question);const score=(c:SourceChunk)=>terms.reduce((n,t)=>n+(c.text.toLowerCase().includes(t)?1:0)+(c.label?.toLowerCase().includes(t)?2:0),0);const ranked=chunks.filter(c=>c.kind!=='heading').sort((a,b)=>score(b)-score(a)||a.offset-b.offset);const selected=(ranked.some(c=>score(c)>0)?ranked.filter(c=>score(c)>0):ranked).slice(0,primaryLimit);return expandSourceContext(chunks,selected.map(c=>c.offset),totalLimit);}
