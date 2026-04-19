'use client';

import { useEffect, useState } from 'react';
import { SlackMessageList } from '@/components/slack/SlackMessageList';
import { SlackConversationDetail } from '@/components/slack/SlackConversationDetail';
import { useSlackStore } from '@/stores/slack-store';
import { useWs } from '@/components/layout/DashboardShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';

export default function SlackPage() {
  const { send } = useWs();
  const { conversations, selectedId, slackConnected } = useSlackStore();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = 'Slack — CTO Dashboard';
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 2000);
    const unsub = useSlackStore.subscribe(() => setLoading(false));
    return () => { clearTimeout(timer); unsub(); };
  }, []);

  const selectedConversation = selectedId != null
    ? conversations.find(c => c.id === selectedId)
    : null;

  return (
    <div className="h-full flex flex-col">
      <PageHeader
        title="Slack"
        badge={
          <div className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ring-1 ${
            slackConnected
              ? 'text-green-400 bg-green-500/10 ring-green-500/20'
              : 'text-zinc-400 bg-zinc-800 ring-zinc-700'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${slackConnected ? 'bg-green-400 animate-pulse' : 'bg-zinc-600'}`} />
            {slackConnected ? 'Connected' : 'Disconnected'}
          </div>
        }
        actions={
          <>
            <button
              onClick={() => send('slack:get_conversations')}
              className="text-xs text-zinc-400 hover:text-zinc-300 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 transition-colors"
            >
              Refresh
            </button>
            {!slackConnected && (
              <button
                onClick={() => send('slack:reconnect')}
                className="text-xs font-medium text-indigo-400 hover:text-indigo-300 px-3 py-1.5 rounded-lg bg-indigo-500/10 ring-1 ring-indigo-500/20 hover:bg-indigo-500/20 transition-all duration-200"
              >
                Reconnect
              </button>
            )}
          </>
        }
      />

      {/* Two-panel layout */}
      <div className="flex-1 overflow-hidden flex">
        {/* Left panel — message list */}
        <div className="w-72 lg:w-[360px] flex-shrink-0 border-r border-zinc-800 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Spinner size="md" />
            </div>
          ) : conversations.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon="\u{1F4AC}"
                title="No Conversations"
                description={slackConnected ? 'No Slack conversations yet.' : 'Configure Slack in Settings to receive messages.'}
                action={!slackConnected ? { label: 'Configure Slack', href: '/settings' } : undefined}
              />
            </div>
          ) : (
            <SlackMessageList />
          )}
        </div>

        {/* Right panel — conversation detail */}
        <div className="flex-1 overflow-hidden">
          {selectedConversation ? (
            <SlackConversationDetail conversation={selectedConversation} />
          ) : (
            <EmptyState
              icon="\u{1F448}"
              title="No Conversation Selected"
              description="Select a conversation from the list to view details."
            />
          )}
        </div>
      </div>
    </div>
  );
}
