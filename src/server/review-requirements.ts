import type {State} from './contracts';

/** Human action items for the current draft only; never evidence of completed operations. */
export function reviewRequirements(state:State){
  return state.workflows.flatMap(workflow=>{
    const candidate=state.revisions.find(r=>r.revision_id===workflow.candidate_revision_id);
    if(!candidate)return [];
    const requirements=Object.values(state.receipts).flatMap(receipt=>{
      const review=receipt.result as any;
      return review?.kind==='semantic_review'&&review.workflow_id===workflow.workflow_id&&review.candidate_content_hash===candidate.content_hash&&Array.isArray(review.verdict?.operational_requirements)
        ?review.verdict.operational_requirements.filter((item:unknown):item is string=>typeof item==='string'):[];
    });
    return [{workflow_id:workflow.workflow_id,revision_id:candidate.revision_id,requirements:[...new Set<string>(requirements)]}];
  });
}
