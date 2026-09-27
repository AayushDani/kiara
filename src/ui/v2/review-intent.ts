import type {Action,CounselEngagement,Proposal} from '@/v2/contracts';

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
