import type {Action,CounselEngagement,DocumentRecord,Matter,Proposal,Source} from '@/v2/contracts';

/** A refreshed view must never silently replace the content a person opened to review. */
export function proposalPreviewCurrent(inspected:Pick<Proposal,'id'|'version'|'contentHash'>,current:Pick<Proposal,'id'|'version'|'contentHash'|'status'>|undefined){
  return !!current&&current.id===inspected.id&&current.version===inspected.version&&current.contentHash===inspected.contentHash&&current.status==='current';
}

/** Authorization applies to the frozen content, recipients and destination hash. */
export function actionPreviewCurrent(inspected:Pick<Action,'id'|'version'|'contentHash'>,current:Pick<Action,'id'|'version'|'contentHash'|'status'>|undefined){
  return !!current&&current.id===inspected.id&&current.version===inspected.version&&current.contentHash===inspected.contentHash&&current.status==='planned';
}

/** Sharing and engagement decisions must stay bound to the inspected packet and recipient. */
export function counselPreviewCurrent(inspected:Pick<CounselEngagement,'id'|'version'|'packetHash'|'counselActorId'>,current:Pick<CounselEngagement,'id'|'version'|'packetHash'|'counselActorId'>|undefined){
  return !!current&&current.id===inspected.id&&current.version===inspected.version&&current.packetHash===inspected.packetHash&&current.counselActorId===inspected.counselActorId;
}

/** A global lesson must retain the exact matter identity, title and access scope selected in Company. */
export function lessonOriginCurrent(inspected:Pick<Matter,'id'|'version'|'title'|'scope'>,current:Pick<Matter,'id'|'version'|'title'|'scope'>|undefined){
  return !!current&&current.id===inspected.id&&current.version===inspected.version&&current.title===inspected.title&&JSON.stringify(current.scope)===JSON.stringify(inspected.scope);
}

export function selectedLessonOrigin<T extends Pick<Matter,'id'>>(matters:T[],selectedId:string):T|undefined {
  return selectedId?matters.find(matter=>matter.id===selectedId):undefined;
}

/** An attached document must still be the exact accessible head and retain its active source. */
export function focusedDocumentCurrent(
  inspected:Pick<DocumentRecord,'id'|'version'|'contentHash'|'sourceId'>,
  current:Pick<DocumentRecord,'id'|'version'|'contentHash'|'sourceId'>|undefined,
  headIds:string[],
  source:Pick<Source,'id'|'status'>|undefined,
){
  return !!current&&current.id===inspected.id&&current.version===inspected.version&&current.contentHash===inspected.contentHash&&current.sourceId===inspected.sourceId&&headIds.includes(inspected.id)&&source?.id===inspected.sourceId&&source.status==='active';
}
