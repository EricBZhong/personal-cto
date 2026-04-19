'use client';

import { createContext, useContext } from 'react';
import { Sidebar } from './Sidebar';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useErrorReporter } from '@/hooks/useErrorReporter';
import { useSetupStore } from '@/stores/setup-store';
import { SetupWizardModal } from '@/components/shared/SetupWizard';
import { ToastContainer } from '@/components/ui/Toast';
import { CommandPalette } from '@/components/ui/CommandPalette';

// Integration setup definitions — maps integration name to setup config
const INTEGRATION_SETUPS: Record<string, import('@/components/shared/SetupWizard').SetupPrompt> = {
  notion: {
    integration: 'notion',
    title: 'Connect Notion',
    description: 'Link your Notion engineering board to sync tickets, get context, and let the CTO create/update tickets.',
    steps: [
      { id: 'notion-key', label: 'API Key', description: 'Create an integration at notion.so/my-integrations, then copy the Internal Integration Secret.', fieldName: 'notionApiKey', fieldType: 'password', placeholder: 'secret_...', helpUrl: 'https://www.notion.so/my-integrations', helpText: 'Create integration' },
      { id: 'notion-board', label: 'Board ID', description: 'Open your engineering board in Notion, copy the ID from the URL (the long string after the workspace name).', fieldName: 'notionBoardId', fieldType: 'text', placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', helpText: 'The ID is in the page URL after your workspace name' },
    ],
  },
  slack: {
    integration: 'slack',
    title: 'Connect Slack',
    description: 'Let the CTO post updates, respond to DMs, and reply to @mentions in Slack channels.',
    steps: [
      { id: 'slack-bot', label: 'Bot Token', description: 'Create a Slack App at api.slack.com/apps \u2192 OAuth & Permissions \u2192 Bot User OAuth Token. Add scopes: chat:write, channels:read, im:read, im:write, app_mentions:read, users:read.', fieldName: 'slackBotToken', fieldType: 'password', placeholder: 'xoxb-...', helpUrl: 'https://api.slack.com/apps', helpText: 'Create Slack App' },
      { id: 'slack-app', label: 'App Token', description: 'Settings \u2192 Basic Information \u2192 App-Level Tokens \u2192 Generate Token (with connections:write scope).', fieldName: 'slackAppToken', fieldType: 'password', placeholder: 'xapp-...' },
      { id: 'slack-channel', label: 'Updates Channel', description: 'Channel where the CTO will post periodic status updates.', fieldName: 'slackUpdateChannel', fieldType: 'text', placeholder: '#engineering-updates' },
    ],
  },
  vanta: {
    integration: 'vanta',
    title: 'Connect Vanta',
    description: 'Track SOC 2 compliance status and let the CTO help with remediation.',
    steps: [
      { id: 'vanta-key', label: 'API Key', description: 'In Vanta, go to Settings \u2192 API \u2192 Create API Token.', fieldName: 'vantaApiKey', fieldType: 'password', placeholder: 'va_...' },
    ],
  },
  twilio: {
    integration: 'twilio',
    title: 'Connect Twilio',
    description: 'Call or text the CTO from your phone.',
    steps: [
      { id: 'twilio-sid', label: 'Account SID', description: 'Find this on your Twilio Console dashboard.', fieldName: 'twilioAccountSid', fieldType: 'text', placeholder: 'AC...', helpUrl: 'https://console.twilio.com', helpText: 'Open Twilio Console' },
      { id: 'twilio-token', label: 'Auth Token', description: 'Also on the Twilio Console dashboard, click to reveal.', fieldName: 'twilioAuthToken', fieldType: 'password', placeholder: '...' },
      { id: 'twilio-phone', label: 'Twilio Phone Number', description: 'Your Twilio phone number.', fieldName: 'twilioPhoneNumber', fieldType: 'text', placeholder: '+1...' },
    ],
  },
  github: {
    integration: 'github',
    title: 'Connect GitHub',
    description: 'Let the CTO see PRs, CI status, and recent commits.',
    steps: [
      { id: 'github-repo', label: 'Repository', description: 'The GitHub repo (owner/name). Make sure `gh` CLI is authenticated.', fieldName: 'githubRepo', fieldType: 'text', placeholder: 'owner/repo' },
    ],
  },
};

interface WsContextValue {
  send: (type: string, payload?: Record<string, unknown>) => void;
  connected: boolean;
  reconnecting: boolean;
}

const WsContext = createContext<WsContextValue>({
  send: (...args) => {
    console.warn('[DashboardShell] send() called on default context — this is a no-op. Ensure component is within <DashboardShell>.', args);
  },
  connected: false,
  reconnecting: false,
});

export function useWs() {
  return useContext(WsContext);
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const { send, connected, reconnecting } = useWebSocket();
  useErrorReporter(send, connected);
  const activeIntegration = useSetupStore((s) => s.activeIntegration);
  const closeSetup = useSetupStore((s) => s.closeSetup);

  const activeSetup = activeIntegration ? INTEGRATION_SETUPS[activeIntegration] : null;

  return (
    <WsContext.Provider value={{ send, connected, reconnecting }}>
      <div className="flex h-screen">
        <Sidebar connected={connected} />
        <main className="flex-1 overflow-hidden">
          {children}
        </main>
      </div>
      {activeSetup && (
        <SetupWizardModal setup={activeSetup} onClose={closeSetup} />
      )}
      <ToastContainer />
      <CommandPalette />
    </WsContext.Provider>
  );
}
