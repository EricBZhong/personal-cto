import { create } from 'zustand';
import type { Project, MemoryEntry, DeployRecord } from '@/types';

interface ProjectStore {
  projects: Project[];
  selectedProjectId: string | null;
  memories: MemoryEntry[];
  deploys: DeployRecord[];

  setProjects: (projects: Project[]) => void;
  addProject: (project: Project) => void;
  updateProject: (project: Project) => void;
  selectProject: (id: string | null) => void;
  setMemories: (memories: MemoryEntry[]) => void;
  addMemory: (entry: MemoryEntry) => void;
  removeMemory: (id: string) => void;
  setDeploys: (deploys: DeployRecord[]) => void;
  addDeploy: (deploy: DeployRecord) => void;
  updateDeploy: (deploy: DeployRecord) => void;
}

export const useProjectStore = create<ProjectStore>((set) => ({
  projects: [],
  selectedProjectId: null,
  memories: [],
  deploys: [],

  setProjects: (projects) => set({ projects }),

  addProject: (project) => set((state) => {
    const exists = state.projects.find(p => p.id === project.id);
    if (exists) {
      return { projects: state.projects.map(p => p.id === project.id ? project : p) };
    }
    return { projects: [project, ...state.projects] };
  }),

  updateProject: (project) => set((state) => ({
    projects: state.projects.map(p => p.id === project.id ? project : p),
  })),

  selectProject: (id) => set({ selectedProjectId: id }),

  setMemories: (memories) => set({ memories }),

  addMemory: (entry) => set((state) => ({
    memories: [entry, ...state.memories],
  })),

  removeMemory: (id) => set((state) => ({
    memories: state.memories.filter(m => m.id !== id),
  })),

  setDeploys: (deploys) => set({ deploys }),

  addDeploy: (deploy) => set((state) => ({
    deploys: [deploy, ...state.deploys],
  })),

  updateDeploy: (deploy) => set((state) => ({
    deploys: state.deploys.map(d => d.id === deploy.id ? deploy : d),
  })),
}));
