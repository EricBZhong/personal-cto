'use client';

import type { SlackConversation } from '@/types';

interface SlackConversationDetailProps {
  conversation: SlackConversation;
}

const typeLabels: Record<string, string> = {
  dm: 'Direct Message',
  mention: 'Channel Mention',
  group: 'Group Chat',
};

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-500/20 text-yellow-400',
  processed: 'bg-green-500/20 text-green-400',
  failed: 'bg-red-500/20 text-red-400',
};

function formatTimestamp(dateStr: string): string {
  return new Date(dateStr).toLocaleString();
}

export function SlackConversationDetail({ conversation }: SlackConversationDetailProps) {
  const slackUrl = conversation.threadTs && conversation.slackChannelId
    ? `https://slack.com/app_redirect?channel=${conversation.slackChannelId}&message_ts=${conversation.threadTs}`
    : null;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-800">
        <div className="flex items-center gap-2 mb-2">
          <h2 className="text-sm font-semibold text-zinc-200 flex-1">
            {conversation.userName || conversation.slackUserId}
          </h2>
          <span className={`text-xs px-2 py-0.5 rounded ${statusColors[conversation.status] || ''}`}>
            {conversation.status}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500">
            {typeLabels[conversation.messageType] || conversation.messageType}
          </span>
          {slackUrl && (
            <a
              href={slackUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-400 hover:text-blue-300 ml-auto"
            >
              Open in Slack
            </a>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* User message */}
        <div className="px-4 py-3 border-b border-zinc-800">
          <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Message</h3>
          <div className="bg-zinc-800 rounded-lg p-3">
            <p className="text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed">
              {conversation.messageText}
            </p>
          </div>
        </div>

        {/* CTO Response */}
        <div className="px-4 py-3 border-b border-zinc-800">
          <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Response</h3>
          {conversation.response ? (
            <div className="bg-zinc-800/50 rounded-lg p-3">
              <p className="text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed">
                {conversation.response}
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-zinc-500">
              {conversation.status === 'pending' ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
                  Pending...
                </>
              ) : (
                <span>No response recorded.</span>
              )}
            </div>
          )}
        </div>

        {/* Metadata */}
        <div className="px-4 py-3 grid grid-cols-2 gap-3 text-xs">
          <div>
            <span className="text-zinc-500 block mb-0.5">Received</span>
            <span className="text-zinc-300">{formatTimestamp(conversation.createdAt)}</span>
          </div>
          <div>
            <span className="text-zinc-500 block mb-0.5">Processed</span>
            <span className="text-zinc-300">
              {conversation.processedAt ? formatTimestamp(conversation.processedAt) : '—'}
            </span>
          </div>
          <div>
            <span className="text-zinc-500 block mb-0.5">Channel</span>
            <span className="text-zinc-300 font-mono">{conversation.slackChannelId}</span>
          </div>
          <div>
            <span className="text-zinc-500 block mb-0.5">User ID</span>
            <span className="text-zinc-300 font-mono">{conversation.slackUserId}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
