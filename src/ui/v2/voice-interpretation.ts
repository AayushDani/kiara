export {interpretVoice,voiceInterpretationCurrent} from '@/v2/voice-interpretation';
export type {FrozenVoiceInterpretation} from '@/v2/voice-interpretation';

export type VoiceChecks={names:boolean;dates:boolean;amounts:boolean};
export const blankVoiceChecks=():VoiceChecks=>({names:false,dates:false,amounts:false});
