'use client';

import type { SlackConversation } from '@/types';

interface SlackMessageCardProps {
  conversation: SlackConversation;
  selected: boolean;
  onClick: () => void;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

const typeIcons: Record<string, string> = {
  dm: '\uD83D\uDCE9',
  mention: '\uD83D\uDCE2',
  group: '\uD83D\uDC65',
};

const typeLabels: Record<string, string> = {
  dm: 'DM',
  mention: 'Mention',
  group: 'Group',
};

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-500/20 text-yellow-400',
  processed: 'bg-green-500/20 text-green-400',
  failed: 'bg-red-500/20 text-red-400',
};

export function SlackMessageCard({ conversation, selected, onClick }: SlackMessageCardProps) {
  return (
    <div
      onClick={onClick}
      className={`px-3 py-2.5 cursor-pointer transition-colors border-l-2 ${
        selected
          ? 'bg-zinc-800 border-blue-500'
          : 'border-transparent hover:bg-zinc-800/50'
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-sm">{typeIcons[conversation.messageType] || '\uD83D\uDCE9'}</span>
        <span className="text-sm font-medium text-zinc-200 truncate flex-1">
          {conversation.userName || conversation.slackUserId}
        </span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${statusColors[conversation.status] || ''}`}>
          {conversation.status}
        </span>
      </div>
      <p className="text-xs text-zinc-400 line-clamp-2 mb-1">
        {conversation.messageText}
      </p>
      <div className="flex items-center gap-2 text-[10px] text-zinc-500">
        <span>{typeLabels[conversation.messageType] || conversation.messageType}</span>
        <span>·</span>
        <span>{timeAgo(conversation.createdAt)}</span>
      </div>
    </div>
  );
}
