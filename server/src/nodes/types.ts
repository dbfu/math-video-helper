export interface StoryboardStep {
  visual: string;
  voice: string;
  duration?: number;
  voiceFileName?: string;
}

export interface WorkflowState {
  problemText: string;
  questions?: string[];
  selectedQuestionIndex?: number;
  selectedQuestion?: string;
  problemAnalysis: string;
  storyboard: StoryboardStep[];
  videoCode: string;
  videoUrl: string;
  error?: string;
  retryCount?: number;
  __streamCallback__?: (nodeName: string, chunk: string) => void;
}
