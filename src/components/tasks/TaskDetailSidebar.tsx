'use client';

import { useEffect, useState, useRef } from 'react';
import { StatusBadge, PriorityBadge, ModelBadge, TokenBadge } from '@/components/shared/StatusBadge';
import { useEngineerStore } from '@/stores/engineer-store';
import type { Task, TaskLog as TaskLogType } from '@/types';
import { timeAgo, formatDateTime } from '@/utils/date';

interface TaskDetailSidebarProps {
  task: Task;
  logs: TaskLogType[];
  onClose: () => void;
  onApprove: (reason?: string) => void;
  onReject: (reason?: string) => void;
  onCancel: () => void;
  onRetry: () => void;
  onRefreshLogs: () => void;
  onSetStatus?: (status: string, reason?: string) => void;
  onInteract?: (instruction: string) => void;
}

const ALL_STATUSES = ['suggested', 'approved', 'queued', 'in_progress', 'verifying', 'in_review', 'done', 'failed', 'cancelled'] as const;

const statusDescriptions: Record<string, string> = {
  suggested: 'The CTO proposed this task. Approve to start an engineer, or reject to dismiss.',
  approved: 'Task approved and queued. An engineer will pick it up shortly.',
  queued: 'Waiting for an available engineer slot.',
  in_progress: 'An engineer agent is actively working on this task.',
  verifying: 'AI is verifying the engineer\'s work against the task requirements.',
  in_review: 'The engineer finished and a PR is ready for review.',
  done: 'Task completed successfully.',
  failed: 'The engineer encountered an error. You can retry.',
  cancelled: 'Task was cancelled.',
};

function EngineerTerminal({ content, maxHeight = 400 }: { content: string; maxHeight?: number }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [content]);

  return (
    <div
      ref={scrollRef}
      className="bg-zinc-950 rounded-lg border border-zinc-800 overflow-y-auto p-3"
      style={{ maxHeight }}
    >
      <pre className="text-xs text-green-400 font-mono whitespace-pre-wrap leading-relaxed">
        {content}
      </pre>
    </div>
  );
}

export function TaskDetailSidebar({ task, logs, onClose, onApprove, onReject, onCancel, onRetry, onRefreshLogs, onSetStatus, onInteract }: TaskDetailSidebarProps) {
  const [showRawOutput, setShowRawOutput] = useState(false);
  const [actionReason, setActionReason] = useState('');
  const [selectedOverrideStatus, setSelectedOverrideStatus] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [interactInstruction, setInteractInstruction] = useState('');
  const engineerLogs = useEngineerStore((s) => s.engineerLogs);

  // Refresh logs when sidebar opens
  useEffect(() => {
    onRefreshLogs();
  }, [task.id]);

  // Separate logs by source
  const summaryLogs = logs.filter(l => l.source === 'summary');
  const engineerOutputLogs = logs.filter(l => l.source === 'engineer');
  const systemLogs = logs.filter(l => l.source === 'system' || l.source === 'stderr');

  // Get live streaming output if engineer is active
  const isActive = task.status === 'in_progress' && !!task.engineer_id;
  const liveOutput = isActive && task.engineer_id ? engineerLogs[task.engineer_id] : undefined;

  // The raw output to display — prefer live streaming if active, else use persisted log
  const rawOutput = liveOutput || engineerOutputLogs.map(l => l.content).join('\n') || '';
  const hasRawOutput = rawOutput.length > 0;
  const hasSummary = summaryLogs.length > 0;

  return (
    <div className="w-80 lg:w-[420px] flex-shrink-0 bg-zinc-900 border-l border-zinc-800 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 p-4 border-b border-zinc-800">
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-zinc-200 leading-snug">{task.title}</h2>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <StatusBadge status={task.status} />
            <PriorityBadge priority={task.priority} />
            <ModelBadge model={task.model} />
            {task.tokens_used > 0 && <TokenBadge tokens={task.tokens_used} />}
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1 text-zinc-500 hover:text-zinc-300 transition-colors flex-shrink-0"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Status context */}
        <div className="px-4 py-3 border-b border-zinc-800">
          <p className="text-xs text-zinc-400 leading-relaxed">
            {statusDescriptions[task.status] || task.status}
          </p>
        </div>

        {/* Description */}
        <div className="px-4 py-3 border-b border-zinc-800">
          <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Description</h3>
          <p className="text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed">
            {task.description || 'No description provided.'}
          </p>
        </div>

        {/* Details grid */}
        <div className="px-4 py-3 border-b border-zinc-800 grid grid-cols-2 gap-3 text-xs">
          <div>
            <span className="text-zinc-500 block mb-0.5">Branch</span>
            <span className="text-zinc-300 font-mono">{task.branch || '—'}</span>
          </div>
          <div>
            <span className="text-zinc-500 block mb-0.5">Engineer</span>
            <span className="text-zinc-300 font-mono">{task.engineer_id?.slice(0, 8) || '—'}</span>
          </div>
          <div>
            <span className="text-zinc-500 block mb-0.5">Created</span>
            <span className="text-zinc-300">{timeAgo(task.created_at)}</span>
          </div>
          <div>
            <span className="text-zinc-500 block mb-0.5">Updated</span>
            <span className="text-zinc-300">{timeAgo(task.updated_at)}</span>
          </div>
          <div className="col-span-2">
            <span className="text-zinc-500 block mb-0.5">Tokens Used</span>
            <span className="text-zinc-300">{(task.tokens_used || 0).toLocaleString()}</span>
          </div>
          {task.actioned_by && (
            <div className="col-span-2">
              <span className="text-zinc-500 block mb-0.5">
                {task.status === 'cancelled' ? 'Rejected by' : 'Approved by'}
              </span>
              <span className="text-zinc-300">{task.actioned_by}</span>
              {task.action_reason && (
                <p className="text-zinc-400 italic mt-0.5">&quot;{task.action_reason}&quot;</p>
              )}
            </div>
          )}
        </div>

        {/* Error History */}
        {(task.errors && task.errors.length > 0 ? true : !!task.error) && (
          <div className="px-4 py-3 border-b border-zinc-800">
            <h3 className="text-xs font-medium text-red-400 uppercase tracking-wider mb-1">
              {(task.errors?.length || 0) > 1 ? `Errors (${task.errors!.length})` : 'Error'}
            </h3>
            <div className="space-y-2">
              {(task.errors && task.errors.length > 0 ? task.errors : task.error ? [task.error] : []).map((err, i) => (
                <div key={i} className="text-sm text-red-300 bg-red-500/10 rounded-lg p-3">
                  {(task.errors?.length || 0) > 1 && (
                    <span className="text-red-500 text-xs font-mono mr-1">#{i + 1}</span>
                  )}
                  {err}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Verification Warning History */}
        {(task.verification_warnings && task.verification_warnings.length > 0 ? true : !!task.verification_warning) && (
          <div className="px-4 py-3 border-b border-zinc-800">
            <h3 className="text-xs font-medium text-amber-400 uppercase tracking-wider mb-1">
              {(task.verification_warnings?.length || 0) > 1 ? `Verification Warnings (${task.verification_warnings!.length})` : 'Verification Warning'}
            </h3>
            <div className="space-y-2">
              {(task.verification_warnings && task.verification_warnings.length > 0 ? task.verification_warnings : task.verification_warning ? [task.verification_warning] : []).map((warning, i) => (
                <div key={i} className="text-sm text-amber-300 bg-amber-500/10 rounded-lg p-3">
                  {(task.verification_warnings?.length || 0) > 1 && (
                    <span className="text-amber-500 text-xs font-mono mr-1">#{i + 1}</span>
                  )}
                  {warning}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* PR Link & Downloads */}
        {task.pr_url && (
          <div className="px-4 py-3 border-b border-zinc-800">
            <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Pull Request</h3>
            <div className="flex flex-col gap-2">
              <a
                href={task.pr_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                View Pull Request
              </a>
              <a
                href={`${task.pr_url}.patch`}
                download
                className="flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-300 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Download Patch
              </a>
              {task.branch && task.pr_url && (() => {
                const match = task.pr_url.match(/https:\/\/github\.com\/([^/]+\/[^/]+)/);
                if (!match) return null;
                const zipUrl = `https://github.com/${match[1]}/archive/refs/heads/${task.branch}.zip`;
                return (
                  <a
                    href={zipUrl}
                    download
                    className="flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-300 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Download ZIP
                  </a>
                );
              })()}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="px-4 py-3 border-b border-zinc-800">
          {task.status === 'suggested' && (
            <>
              <input
                type="text"
                value={actionReason}
                onChange={(e) => setActionReason(e.target.value)}
                placeholder="Reason (optional)"
                className="w-full mb-2 px-3 py-1.5 text-xs rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 placeholder-zinc-500 focus:outline-none focus:border-zinc-600"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => { onApprove(actionReason || undefined); setActionReason(''); }}
                  className="flex-1 py-2 rounded-lg text-sm font-medium bg-green-600 hover:bg-green-700 text-white transition-colors"
                >
                  Approve & Run
                </button>
                <button
                  onClick={() => { onReject(actionReason || undefined); setActionReason(''); }}
                  className="flex-1 py-2 rounded-lg text-sm font-medium bg-red-600 hover:bg-red-700 text-white transition-colors"
                >
                  Reject
                </button>
              </div>
            </>
          )}
          {(task.status === 'failed' || task.status === 'cancelled') && (
            <button
              onClick={onRetry}
              className="w-full py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors"
            >
              Retry
            </button>
          )}
          {(task.status === 'in_progress' || task.status === 'approved' || task.status === 'queued') && (
            <button
              onClick={onCancel}
              className="w-full py-2 rounded-lg text-sm font-medium bg-red-600 hover:bg-red-700 text-white transition-colors"
            >
              Cancel
            </button>
          )}
        </div>

        {/* Send Follow-up */}
        {onInteract && ['in_review', 'done', 'failed', 'cancelled'].includes(task.status) && (
          <div className="px-4 py-3 border-b border-zinc-800">
            <h3 className="text-xs font-medium text-cyan-400 uppercase tracking-wider mb-2">Send Follow-up</h3>
            <textarea
              value={interactInstruction}
              onChange={(e) => setInteractInstruction(e.target.value)}
              placeholder="e.g., fix the merge conflict, add tests, update the PR description..."
              rows={3}
              className="w-full mb-2 px-3 py-2 text-xs rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 placeholder-zinc-500 focus:outline-none focus:border-cyan-600 resize-none"
            />
            <button
              onClick={() => {
                if (interactInstruction.trim()) {
                  onInteract(interactInstruction.trim());
                  setInteractInstruction('');
                }
              }}
              disabled={!interactInstruction.trim()}
              className="w-full py-2 rounded-lg text-sm font-medium bg-cyan-600 hover:bg-cyan-700 disabled:bg-zinc-700 disabled:text-zinc-500 text-white transition-colors"
            >
              Send Follow-up
            </button>
          </div>
        )}

        {/* Move to... override */}
        {onSetStatus && (
          <div className="px-4 py-3 border-b border-zinc-800">
            <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Move to&hellip;</h3>
            <select
              value={selectedOverrideStatus}
              onChange={(e) => setSelectedOverrideStatus(e.target.value)}
              className="w-full mb-2 px-3 py-1.5 text-xs rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 focus:outline-none focus:border-zinc-600"
            >
              <option value="">Select status</option>
              {ALL_STATUSES.filter(s => s !== task.status).map(s => (
                <option key={s} value={s}>{s.replace('_', ' ')}</option>
              ))}
            </select>
            {selectedOverrideStatus && (
              <>
                <input
                  type="text"
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="Reason (optional)"
                  className="w-full mb-2 px-3 py-1.5 text-xs rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 placeholder-zinc-500 focus:outline-none focus:border-zinc-600"
                />
                <button
                  onClick={() => {
                    onSetStatus(selectedOverrideStatus, overrideReason || undefined);
                    setSelectedOverrideStatus('');
                    setOverrideReason('');
                  }}
                  className="w-full py-2 rounded-lg text-sm font-medium bg-violet-600 hover:bg-violet-700 text-white transition-colors"
                >
                  Move to {selectedOverrideStatus.replace('_', ' ')}
                </button>
              </>
            )}
          </div>
        )}

        {/* Follow-up History */}
        {logs.filter(l => l.source === 'interaction').length > 0 && (
          <div className="px-4 py-3 border-b border-zinc-800">
            <h3 className="text-xs font-medium text-cyan-400 uppercase tracking-wider mb-2">Follow-up History</h3>
            <div className="space-y-2">
              {logs.filter(l => l.source === 'interaction').map((log) => (
                <div key={log.id} className="bg-cyan-500/10 border border-cyan-500/20 rounded-lg p-3">
                  <p className="text-xs text-zinc-500 mb-1">{formatDateTime(log.timestamp)}</p>
                  <p className="text-sm text-cyan-300 whitespace-pre-wrap">{log.content}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Engineer Summary */}
        {hasSummary && (
          <div className="px-4 py-3 border-b border-zinc-800">
            <h3 className="text-xs font-medium text-blue-400 uppercase tracking-wider mb-2">Engineer Summary</h3>
            <div className="bg-zinc-800/50 rounded-lg p-3 text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed">
              {summaryLogs.map(l => l.content).join('\n')}
            </div>
          </div>
        )}

        {/* Live Engineer Output (when active) */}
        {isActive && liveOutput && (
          <div className="px-4 py-3 border-b border-zinc-800">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              <h3 className="text-xs font-medium text-amber-400 uppercase tracking-wider">Live Output</h3>
            </div>
            <EngineerTerminal content={liveOutput} maxHeight={300} />
          </div>
        )}

        {/* Raw Engineer Output (collapsed by default, for completed/failed tasks) */}
        {hasRawOutput && !isActive && (
          <div className="px-4 py-3 border-b border-zinc-800">
            <button
              onClick={() => setShowRawOutput(!showRawOutput)}
              className="flex items-center gap-2 w-full text-left group"
            >
              <svg
                className={`w-3 h-3 text-zinc-500 transition-transform ${showRawOutput ? 'rotate-90' : ''}`}
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path d="M6.293 7.293a1 1 0 011.414 0L10 9.586l2.293-2.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" />
              </svg>
              <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider group-hover:text-zinc-400 transition-colors">
                Raw Engineer Output
              </h3>
              <span className="text-xs text-zinc-600 ml-auto">
                {(rawOutput.length / 1024).toFixed(1)}KB
              </span>
            </button>
            {showRawOutput && (
              <div className="mt-2">
                <EngineerTerminal content={rawOutput} maxHeight={500} />
              </div>
            )}
          </div>
        )}

        {/* System Logs */}
        <div className="px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider">System Logs</h3>
            <button
              onClick={onRefreshLogs}
              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              Refresh
            </button>
          </div>
          {systemLogs.length > 0 ? (
            <div className="bg-zinc-950 rounded-lg border border-zinc-800 font-mono text-xs overflow-y-auto max-h-[200px] p-3">
              {systemLogs.map((log) => (
                <div key={log.id} className="mb-1">
                  <span className={log.source === 'stderr' ? 'text-red-400' : 'text-yellow-500'}>
                    [{log.source}]
                  </span>
                  <span className="text-zinc-500 ml-2">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </span>
                  <pre className="text-zinc-300 whitespace-pre-wrap mt-0.5 ml-4">{log.content}</pre>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-zinc-600">No system logs.</p>
          )}
        </div>
      </div>
    </div>
  );
}
