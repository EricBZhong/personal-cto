import { create } from 'zustand';
import type { SlackConversation } from '@/types';

type SlackFilter = 'all' | 'pending' | 'processed' | 'failed';

interface SlackStore {
  conversations: SlackConversation[];
  queue: SlackConversation[];
  selectedId: number | null;
  filter: SlackFilter;
  slackConnected: boolean;

  setConversations: (conversations: SlackConversation[]) => void;
  setQueue: (queue: SlackConversation[]) => void;
  selectConversation: (id: number | null) => void;
  setFilter: (filter: SlackFilter) => void;
  setSlackConnected: (connected: boolean) => void;
}

export const useSlackStore = create<SlackStore>((set) => ({
  conversations: [],
  queue: [],
  selectedId: null,
  filter: 'all',
  slackConnected: false,

  setConversations: (conversations) => set({ conversations }),
  setQueue: (queue) => set({ queue }),
  selectConversation: (id) => set({ selectedId: id }),
  setFilter: (filter) => set({ filter }),
  setSlackConnected: (connected) => set({ slackConnected: connected }),
}));
