'use client';

import { useSlackStore } from '@/stores/slack-store';
import { SlackMessageCard } from './SlackMessageCard';

const filterTabs = [
  { key: 'all' as const, label: 'All' },
  { key: 'pending' as const, label: 'Queued' },
  { key: 'processed' as const, label: 'Processed' },
  { key: 'failed' as const, label: 'Failed' },
];

export function SlackMessageList() {
  const { conversations, filter, selectedId, setFilter, selectConversation } = useSlackStore();

  const filtered = filter === 'all'
    ? conversations
    : conversations.filter(c => c.status === filter);

  return (
    <div className="flex flex-col h-full">
      {/* Filter tabs */}
      <div className="flex border-b border-zinc-800 px-2">
        {filterTabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`px-3 py-2 text-xs font-medium transition-colors border-b-2 ${
              filter === tab.key
                ? 'text-blue-400 border-blue-400'
                : 'text-zinc-500 border-transparent hover:text-zinc-300'
            }`}
          >
            {tab.label}
            {tab.key !== 'all' && (
              <span className="ml-1 text-zinc-600">
                ({conversations.filter(c => c.status === tab.key).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-full p-6">
            <p className="text-sm text-zinc-500 text-center">
              {filter === 'all'
                ? 'No Slack conversations yet. Messages from @mentions and DMs will appear here.'
                : `No ${filter} messages.`}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-zinc-800/50">
            {filtered.map(conv => (
              <SlackMessageCard
                key={conv.id}
                conversation={conv}
                selected={selectedId === conv.id}
                onClick={() => selectConversation(conv.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
