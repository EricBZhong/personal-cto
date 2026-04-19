import { create } from 'zustand';

interface SetupStore {
  /** Which integration to show the setup wizard for (null = hidden) */
  activeIntegration: string | null;
  /** Open the setup wizard for an integration */
  openSetup: (integration: string) => void;
  /** Close the setup wizard */
  closeSetup: () => void;
}

export const useSetupStore = create<SetupStore>((set) => ({
  activeIntegration: null,
  openSetup: (integration) => set({ activeIntegration: integration }),
  closeSetup: () => set({ activeIntegration: null }),
}));
