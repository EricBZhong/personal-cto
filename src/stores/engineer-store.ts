import { create } from 'zustand';
import type { Engineer, SystemStatus } from '@/types';
import type { EngineerProgress } from '@/lib/engineer-progress';
import { parseChunkForProgress, createEmptyProgress } from '@/lib/engineer-progress';

interface EngineerStore {
  engineers: Engineer[];
  systemStatus: SystemStatus;
  engineerLogs: Record<string, string>; // engineerId → accumulated output
  engineerProgress: Record<string, EngineerProgress>; // engineerId → progress

  setEngineers: (engineers: Engineer[]) => void;
  addEngineer: (engineer: Engineer) => void;
  removeEngineer: (engineerId: string) => void;
  appendEngineerLog: (engineerId: string, text: string) => void;
  setSystemStatus: (status: SystemStatus) => void;
}

const MAX_LOG_SIZE = 500 * 1024; // 500KB per engineer

export const useEngineerStore = create<EngineerStore>((set) => ({
  engineers: [],
  systemStatus: { engineers: 0, activeTasks: 0, dailyTokens: 0 },
  engineerLogs: {},
  engineerProgress: {},

  setEngineers: (engineers) => set({ engineers }),

  addEngineer: (engineer) => {
    set((state) => ({
      engineers: [...state.engineers.filter((e) => e.id !== engineer.id), engineer],
      engineerProgress: {
        ...state.engineerProgress,
        [engineer.id]: createEmptyProgress(),
      },
    }));
  },

  removeEngineer: (engineerId) => {
    set((state) => {
      const { [engineerId]: _log, ...remainingLogs } = state.engineerLogs;
      const { [engineerId]: _progress, ...remainingProgress } = state.engineerProgress;
      return {
        engineers: state.engineers.filter((e) => e.id !== engineerId),
        engineerLogs: remainingLogs,
        engineerProgress: remainingProgress,
      };
    });
  },

  appendEngineerLog: (engineerId, text) => {
    set((state) => {
      const existing = state.engineerProgress[engineerId] || createEmptyProgress();
      const updated = parseChunkForProgress(text, existing);

      let newLog = (state.engineerLogs[engineerId] || '') + text;
      // Cap log size at 500KB — truncate from the beginning if exceeded
      if (newLog.length > MAX_LOG_SIZE) {
        newLog = newLog.slice(newLog.length - MAX_LOG_SIZE);
      }

      return {
        engineerLogs: {
          ...state.engineerLogs,
          [engineerId]: newLog,
        },
        engineerProgress: {
          ...state.engineerProgress,
          [engineerId]: updated,
        },
      };
    });
  },

  setSystemStatus: (status) => set({ systemStatus: status }),
}));
