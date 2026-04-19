'use client';

import { useState, useRef, useEffect } from 'react';
import { PriorityBadge, ModelBadge } from '@/components/shared/StatusBadge';

interface TaskSuggestion {
  title: string;
  description: string;
  branch?: string;
  model?: string;
  maxBudget?: number;
  priority?: string;
}

interface TaskSuggestionCardProps {
  task: TaskSuggestion;
  send: (type: string, payload?: Record<string, unknown>) => void;
}

type DecisionState = 'pending' | 'approved' | 'rejected';

export function TaskSuggestionCard({ task, send }: TaskSuggestionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [priority, setPriority] = useState(task.priority || 'P2');
  const [model, setModel] = useState(task.model || 'sonnet');
  const [decision, setDecision] = useState<DecisionState>('pending');
  const cardRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | undefined>(undefined);

  // Capture natural height before collapsing
  useEffect(() => {
    if (decision !== 'pending' && cardRef.current && height === undefined) {
      setHeight(cardRef.current.scrollHeight);
    }
  }, [decision, height]);

  // Animate collapse after a brief delay showing the result
  useEffect(() => {
    if (decision !== 'pending' && height !== undefined) {
      // First frame: set explicit height so transition works
      requestAnimationFrame(() => {
        if (cardRef.current) {
          cardRef.current.style.height = `${height}px`;
          // Next frame: collapse to final height
          requestAnimationFrame(() => {
            if (cardRef.current) {
              cardRef.current.style.height = '48px';
            }
          });
        }
      });
    }
  }, [decision, height]);

  const handleApprove = () => {
    setDecision('approved');
    send('task:approve_by_title', { title: task.title, priority, model });
  };

  const handleReject = () => {
    setDecision('rejected');
    send('task:reject_by_title', { title: task.title });
  };

  if (decision !== 'pending') {
    const isApproved = decision === 'approved';
    return (
      <div
        ref={cardRef}
        className={`my-3 mx-1 rounded-xl border overflow-hidden transition-all duration-500 ease-in-out ${
          isApproved
            ? 'bg-green-500/5 border-green-500/30'
            : 'bg-red-500/5 border-red-500/30'
        }`}
        style={{ height: height ?? undefined }}
      >
        <div className="flex items-center gap-3 px-4 py-3 h-12">
          <span className={`text-sm ${isApproved ? 'text-green-400' : 'text-red-400'}`}>
            {isApproved ? '✓' : '✗'}
          </span>
          <span className="text-sm text-zinc-400 truncate flex-1">{task.title}</span>
          <span className={`text-xs font-medium ${isApproved ? 'text-green-400' : 'text-red-400'}`}>
            {isApproved ? 'Approved' : 'Rejected'}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={cardRef}
      className="my-3 mx-1 rounded-xl bg-zinc-800/80 border border-zinc-700 overflow-hidden transition-all duration-500 ease-in-out"
    >
      {/* Header */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-medium text-zinc-200">{task.title}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              {task.branch && <span className="font-mono">{task.branch}</span>}
              <PriorityBadge priority={priority} />
              <ModelBadge model={model} />
            </div>
          </div>
        </div>

        {/* Expandable description */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-zinc-400 hover:text-zinc-300 mt-2 underline"
        >
          {expanded ? 'Hide details' : 'Show details'}
        </button>

        {expanded && (
          <div className="mt-3 space-y-3">
            <p className="text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed">
              {task.description}
            </p>
            {/* Override controls */}
            <div className="flex items-center gap-4 text-xs">
              <label className="flex items-center gap-1.5 text-zinc-400">
                Priority:
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  className="bg-zinc-700 border border-zinc-600 rounded px-2 py-1 text-zinc-200"
                >
                  <option value="P0">P0 (Critical)</option>
                  <option value="P1">P1 (High)</option>
                  <option value="P2">P2 (Medium)</option>
                  <option value="P3">P3 (Low)</option>
                </select>
              </label>
              <label className="flex items-center gap-1.5 text-zinc-400">
                Model:
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="bg-zinc-700 border border-zinc-600 rounded px-2 py-1 text-zinc-200"
                >
                  <option value="opus">Opus</option>
                  <option value="sonnet">Sonnet</option>
                  <option value="haiku">Haiku</option>
                </select>
              </label>
            </div>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex border-t border-zinc-700">
        <button
          onClick={handleApprove}
          className="flex-1 py-2.5 text-sm font-medium text-green-400 hover:bg-green-500/10 transition-colors"
        >
          Approve & Run
        </button>
        <div className="w-px bg-zinc-700" />
        <button
          onClick={handleReject}
          className="flex-1 py-2.5 text-sm font-medium text-red-400 hover:bg-red-500/10 transition-colors"
        >
          Reject
        </button>
      </div>
    </div>
  );
}
