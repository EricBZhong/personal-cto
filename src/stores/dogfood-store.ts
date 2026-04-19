import { create } from 'zustand';
import type { DogfoodResult } from '@/types';

export interface EvalDefinition {
  id: string;
  name: string;
  description: string;
  category: 'functional' | 'edge-case' | 'performance' | 'accessibility' | 'security';
  input: string;
  expectedBehavior?: string;
  maxTtftMs?: number;
  maxResponseMs?: number;
  expectNoErrors: boolean;
  createdBy: 'user' | 'cto';
  created_at: string;
}

export interface EvalRunResult {
  evalId: string;
  evalName: string;
  passed: boolean;
  ttft_ms?: number;
  response_ms?: number;
  responseSnippet?: string;
  consoleErrors: string[];
  notes: string[];
  run_at: string;
}

export interface DogfoodLiveLog {
  step?: string;
  log?: string;
  timestamp: number;
}

export interface DogfoodLiveScreenshot {
  label: string;
  base64: string;
  timestamp: number;
}

interface DogfoodStore {
  running: boolean;
  testType: string | null;
  withAnalysis: boolean;
  results: DogfoodResult[];
  report: string;
  error: string | null;
  history: Array<{
    timestamp: string;
    testType: string;
    results: DogfoodResult[];
    report: string;
  }>;

  // Live progress
  liveLogs: DogfoodLiveLog[];
  liveScreenshots: DogfoodLiveScreenshot[];
  currentStep: string | null;

  // Evals
  evals: EvalDefinition[];
  evalHistory: EvalRunResult[];
  importResult: { created: number; error?: string } | null;

  setRunning: (testType: string, withAnalysis?: boolean) => void;
  setResults: (results: DogfoodResult[], report: string) => void;
  setError: (error: string) => void;
  addProgress: (event: { type: string; step?: string; log?: string; screenshot?: { label: string; base64: string }; timestamp: number }) => void;
  reset: () => void;
  handleEvalEvent: (type: string, payload: Record<string, unknown>) => void;
}

export const useDogfoodStore = create<DogfoodStore>((set) => ({
  running: false,
  testType: null,
  withAnalysis: false,
  results: [],
  report: '',
  error: null,
  history: [],
  liveLogs: [],
  liveScreenshots: [],
  currentStep: null,
  evals: [],
  evalHistory: [],
  importResult: null,

  setRunning: (testType, withAnalysis = false) =>
    set({ running: true, testType, withAnalysis, error: null, results: [], report: '', liveLogs: [], liveScreenshots: [], currentStep: null }),

  setResults: (results, report) =>
    set((state) => ({
      running: false,
      results,
      report,
      currentStep: null,
      history: [
        { timestamp: new Date().toISOString(), testType: state.testType || 'unknown', results, report },
        ...state.history.slice(0, 9),
      ],
    })),

  setError: (error) => set({ running: false, error, currentStep: null }),

  addProgress: (event) =>
    set((state) => {
      if (event.type === 'screenshot' && event.screenshot) {
        return {
          liveScreenshots: [...state.liveScreenshots, { label: event.screenshot.label, base64: event.screenshot.base64, timestamp: event.timestamp }],
        };
      }
      // step or log
      return {
        liveLogs: [...state.liveLogs, { step: event.step, log: event.log, timestamp: event.timestamp }],
        ...(event.type === 'step' && event.step ? { currentStep: event.step } : {}),
      };
    }),

  reset: () => set({ running: false, testType: null, results: [], report: '', error: null, importResult: null, liveLogs: [], liveScreenshots: [], currentStep: null }),

  handleEvalEvent: (type, payload) => {
    switch (type) {
      case 'eval:list':
        set({ evals: (payload.evals as EvalDefinition[]) || [] });
        break;
      case 'eval:created':
        set((state) => ({
          evals: [payload.eval as EvalDefinition, ...state.evals],
        }));
        break;
      case 'eval:deleted':
        set((state) => ({
          evals: state.evals.filter(e => e.id !== payload.evalId),
        }));
        break;
      case 'eval:history':
        set({ evalHistory: (payload.history as EvalRunResult[]) || [] });
        break;
      case 'eval:import_done':
        set({
          running: false,
          importResult: {
            created: (payload.created as number) || 0,
            error: payload.error as string | undefined,
          },
        });
        break;
    }
  },
}));
