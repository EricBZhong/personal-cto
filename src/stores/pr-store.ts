import { create } from 'zustand';
import type { PullRequest, PRReview } from '@/types';

interface PRStore {
  prs: PullRequest[];
  selectedPR: number | null;
  prDetail: { pr: PullRequest; diff: string; reviews: PRReview[] } | null;
  reviewInProgress: number | null;
  lastReviewText: string | null;
  lastReviewRecommendation: string | null;
  error: string | null;

  setPRs: (prs: PullRequest[]) => void;
  addPR: (pr: PullRequest) => void;
  selectPR: (prNumber: number | null) => void;
  setPRDetail: (detail: { pr: PullRequest; diff: string; reviews: PRReview[] }) => void;
  setReviewInProgress: (prNumber: number | null) => void;
  setReviewComplete: (prNumber: number, reviewText: string, recommendation: string) => void;
  setError: (error: string | null) => void;
  handleActionResult: (prNumber: number, action: string, success: boolean, error?: string) => void;
}

export const usePRStore = create<PRStore>((set) => ({
  prs: [],
  selectedPR: null,
  prDetail: null,
  reviewInProgress: null,
  lastReviewText: null,
  lastReviewRecommendation: null,
  error: null,

  setPRs: (prs) => set({ prs }),

  addPR: (pr) => set((state) => {
    if (state.prs.some(p => p.url === pr.url)) return state;
    return { prs: [pr, ...state.prs] };
  }),

  selectPR: (prNumber) => set({ selectedPR: prNumber, prDetail: null }),

  setPRDetail: (detail) => set({ prDetail: detail }),

  setReviewInProgress: (prNumber) => set({ reviewInProgress: prNumber, lastReviewText: null, lastReviewRecommendation: null }),

  setReviewComplete: (prNumber, reviewText, recommendation) => set({
    reviewInProgress: null,
    lastReviewText: reviewText,
    lastReviewRecommendation: recommendation,
  }),

  setError: (error) => set({ error }),

  handleActionResult: (_prNumber, _action, success, error) => {
    if (!success && error) {
      set({ error });
    } else {
      set({ error: null });
    }
  },
}));
