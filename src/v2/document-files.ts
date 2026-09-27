import mammoth from 'mammoth';
import {Document,Packer,Paragraph,TextRun,HeadingLevel} from 'docx';
import {V2Error} from './contracts';
import {crc32,inflateRawSync} from 'node:zlib';

/** Inspect ZIP admission before handing an untrusted DOCX to its parser. */
export function inspectDocx(bytes:Buffer){
 let eocd=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(bytes.readUInt32LE(i)===0x06054b50){eocd=i;break;}
 if(eocd<0)throw new V2Error('INVALID_DOCX','This file is not a complete DOCX archive.',400);
 const entries=bytes.readUInt16LE(eocd+10),size=bytes.readUInt32LE(eocd+12),start=bytes.readUInt32LE(eocd+16);
 if(bytes.readUInt16LE(eocd+4)!==0||bytes.readUInt16LE(eocd+6)!==0||bytes.readUInt16LE(eocd+8)!==entries||entries===65535||entries>1500||start+size!==eocd||eocd+22+bytes.readUInt16LE(eocd+20)!==bytes.length)throw new V2Error('DOCX_CAPACITY','Split, ZIP64 or oversized document archives are unsupported.',413);
 let offset=start,total=0,hasDocument=false;const names=new Set<string>(),segments:{start:number;end:number}[]=[];
 for(let n=0;n<entries;n++){
  if(offset+46>bytes.length||bytes.readUInt32LE(offset)!==0x02014b50)throw new V2Error('INVALID_DOCX','The archive directory is invalid.',400);
  const flags=bytes.readUInt16LE(offset+8),method=bytes.readUInt16LE(offset+10),compressed=bytes.readUInt32LE(offset+20),expanded=bytes.readUInt32LE(offset+24),nameLength=bytes.readUInt16LE(offset+28),extraLength=bytes.readUInt16LE(offset+30),commentLength=bytes.readUInt16LE(offset+32),end=offset+46+nameLength+extraLength+commentLength;
  if(end>start+size)throw new V2Error('INVALID_DOCX','The archive directory is truncated.',400);
  const name=bytes.subarray(offset+46,offset+46+nameLength).toString('utf8');total+=expanded;
  if(flags&1||![0,8].includes(method)||total>20_000_000||expanded>Math.max(1,compressed)*200||name.split(/[\\/]/).includes('..')||name.startsWith('/')||name.includes('\0')||/vbaProject|\.exe$/i.test(name))throw new V2Error('DOCX_CAPACITY','Encrypted, executable or excessive archive contents are not supported.',413);
  if(names.has(name))throw new V2Error('INVALID_DOCX','Duplicate document archive entries are unsupported.',400);names.add(name);
  const local=bytes.readUInt32LE(offset+42);
  if(local+30>start||bytes.readUInt32LE(local)!==0x04034b50||bytes.readUInt16LE(local+6)!==flags||bytes.readUInt16LE(local+8)!==method)throw new V2Error('INVALID_DOCX','Local archive headers differ from the directory.',400);
  const localNameLength=bytes.readUInt16LE(local+26),localExtra=bytes.readUInt16LE(local+28),dataStart=local+30+localNameLength+localExtra,dataEnd=dataStart+compressed;
  if(dataEnd>start||bytes.subarray(local+30,local+30+localNameLength).toString('utf8')!==name||segments.some(segment=>local<segment.end&&dataEnd>segment.start))throw new V2Error('INVALID_DOCX','Document archive entries overlap or have inconsistent names.',400);
  segments.push({start:local,end:dataEnd});
  if(!(flags&8)&&(bytes.readUInt32LE(local+14)!==bytes.readUInt32LE(offset+16)||bytes.readUInt32LE(local+18)!==compressed||bytes.readUInt32LE(local+22)!==expanded))throw new V2Error('INVALID_DOCX','Archive sizes or checksums differ between headers.',400);
  let unpacked:Buffer;try{unpacked=method===0?bytes.subarray(dataStart,dataEnd):inflateRawSync(bytes.subarray(dataStart,dataEnd),{maxOutputLength:Math.max(1,expanded)});}catch{throw new V2Error('DOCX_CAPACITY','Document content exceeds its declared archive size or is malformed.',413);}
  if(unpacked.length!==expanded||crc32(unpacked)!==bytes.readUInt32LE(offset+16))throw new V2Error('INVALID_DOCX','Document content differs from its archive integrity manifest.',400);
  if(name==='word/document.xml')hasDocument=true;offset=end;
 }
 if(offset!==start+size||!hasDocument)throw new V2Error('INVALID_DOCX','No valid Word document body and directory were found.',400);
}
export async function parseDocument(bytes:Buffer,filename:string):Promise<{text:string;warnings:string[]}>{
 if(bytes.length>10_000_000||!bytes.length)throw new V2Error('DOCUMENT_CAPACITY','Choose a nonempty document below 10 MB.',413);
 if(/\.docx$/i.test(filename)){
  inspectDocx(bytes);const result=await mammoth.extractRawText({buffer:bytes});
  if(!result.value.trim()||result.value.length>100000)throw new V2Error('DOCUMENT_TEXT_CAPACITY','Extracted document text must contain 1–100,000 characters.',413);
  return {text:result.value,warnings:['Original Word bytes are retained. Extracted text is a review aid; formatting, annotations, signatures and tracked-change semantics require comparison with the original.',...result.messages.map(m=>m.message.slice(0,300))]};
 }
 if(!/\.(txt|md)$/i.test(filename))throw new V2Error('DOCUMENT_FORMAT','Upload a DOCX, UTF-8 text or Markdown file. PDF/OCR and legacy .doc parsing are not configured.',415);
 let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new V2Error('DOCUMENT_ENCODING','Use UTF-8 document text.',400);}
 if(!text.trim()||text.length>100000)throw new V2Error('DOCUMENT_TEXT_CAPACITY','Use at most 100,000 text characters.',413);
 return {text,warnings:[]};
}
export async function exportReviewDocx(input:{title:string;body:string;manifest:string[]}):Promise<Buffer>{
 const document=new Document({creator:'Kiara',title:input.title,description:'Controlled review copy. Original source bytes and prior revisions remain retained.',sections:[{properties:{},children:[new Paragraph({text:input.title,heading:HeadingLevel.TITLE}),new Paragraph({children:[new TextRun({text:'REVIEW COPY · see authority and approval manifest',bold:true})]}),...input.body.split('\n').map(line=>new Paragraph({children:[new TextRun(line)]})),new Paragraph({text:'Authority and review manifest',heading:HeadingLevel.HEADING_1}),...input.manifest.map(line=>new Paragraph({children:[new TextRun({text:line,size:18})]}))]}]});
 return Packer.toBuffer(document);
}
