'use client';

import { useEffect, useState, use } from 'react';
import { useWs } from '@/components/layout/DashboardShell';
import { useTaskStore } from '@/stores/task-store';
import { TaskLog } from '@/components/tasks/TaskLog';
import { StatusBadge, PriorityBadge, ModelBadge, TokenBadge } from '@/components/shared/StatusBadge';
import Link from 'next/link';

const ALL_STATUSES = ['suggested', 'approved', 'queued', 'in_progress', 'in_review', 'done', 'failed', 'cancelled'] as const;

export default function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { send } = useWs();
  const { tasks, taskLogs } = useTaskStore();
  const [task, setTask] = useState(tasks.find(t => t.id === id));
  const [selectedOverrideStatus, setSelectedOverrideStatus] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [interactInstruction, setInteractInstruction] = useState('');

  useEffect(() => {
    send('task:get', { taskId: id });
    send('task:logs', { taskId: id });
  }, [id, send]);

  useEffect(() => {
    const found = tasks.find(t => t.id === id);
    if (found) setTask(found);
  }, [tasks, id]);

  if (!task) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-zinc-500">Loading task...</div>
      </div>
    );
  }

  const logs = taskLogs[id] || [];

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div>
          <Link href="/tasks" className="text-sm text-zinc-500 hover:text-zinc-300 mb-2 inline-block">
            &larr; Back to Task Board
          </Link>
          <h1 className="text-xl font-semibold text-zinc-200">{task.title}</h1>
          <div className="flex items-center gap-2 mt-2">
            <StatusBadge status={task.status} />
            <PriorityBadge priority={task.priority} />
            <ModelBadge model={task.model} />
            {task.tokens_used > 0 && <TokenBadge tokens={task.tokens_used} />}
          </div>
        </div>

        {/* Details */}
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-zinc-500">Branch:</span>
            <span className="ml-2 text-zinc-300 font-mono">{task.branch || 'N/A'}</span>
          </div>
          <div>
            <span className="text-zinc-500">Engineer:</span>
            <span className="ml-2 text-zinc-300 font-mono">{task.engineer_id?.slice(0, 8) || 'None'}</span>
          </div>
          <div>
            <span className="text-zinc-500">Created:</span>
            <span className="ml-2 text-zinc-300">{new Date(task.created_at).toLocaleString()}</span>
          </div>
          <div>
            <span className="text-zinc-500">Updated:</span>
            <span className="ml-2 text-zinc-300">{new Date(task.updated_at).toLocaleString()}</span>
          </div>
        </div>

        {/* Description */}
        <div>
          <h2 className="text-sm font-medium text-zinc-400 mb-2">Description</h2>
          <div className="bg-zinc-800 rounded-lg p-4 text-sm text-zinc-300 whitespace-pre-wrap">
            {task.description || 'No description.'}
          </div>
        </div>

        {/* Error History */}
        {(task.errors && task.errors.length > 0 ? true : !!task.error) && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
            <h2 className="text-sm font-medium text-red-400 mb-2">
              {(task.errors?.length || 0) > 1 ? `Errors (${task.errors!.length})` : 'Error'}
            </h2>
            <div className="space-y-2">
              {(task.errors && task.errors.length > 0 ? task.errors : task.error ? [task.error] : []).map((err, i) => (
                <p key={i} className="text-sm text-red-300">
                  {(task.errors?.length || 0) > 1 && <span className="text-red-500 font-mono mr-1">#{i + 1}</span>}
                  {err}
                </p>
              ))}
            </div>
          </div>
        )}

        {/* Verification Warning History */}
        {(task.verification_warnings && task.verification_warnings.length > 0 ? true : !!task.verification_warning) && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
            <h2 className="text-sm font-medium text-amber-400 mb-2">
              {(task.verification_warnings?.length || 0) > 1 ? `Verification Warnings (${task.verification_warnings!.length})` : 'Verification Warning'}
            </h2>
            <div className="space-y-2">
              {(task.verification_warnings && task.verification_warnings.length > 0 ? task.verification_warnings : task.verification_warning ? [task.verification_warning] : []).map((warning, i) => (
                <p key={i} className="text-sm text-amber-300">
                  {(task.verification_warnings?.length || 0) > 1 && <span className="text-amber-500 font-mono mr-1">#{i + 1}</span>}
                  {warning}
                </p>
              ))}
            </div>
          </div>
        )}

        {/* PR Link & Downloads */}
        {task.pr_url && (
          <div>
            <h2 className="text-sm font-medium text-zinc-400 mb-2">Pull Request</h2>
            <div className="flex flex-wrap items-center gap-3">
              <a
                href={task.pr_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 text-sm transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                View PR
              </a>
              <a
                href={`${task.pr_url}.patch`}
                download
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-700/50 text-zinc-300 hover:bg-zinc-700 text-sm transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Patch
              </a>
              {task.branch && task.pr_url && (() => {
                const match = task.pr_url.match(/https:\/\/github\.com\/([^/]+\/[^/]+)/);
                if (!match) return null;
                const zipUrl = `https://github.com/${match[1]}/archive/refs/heads/${task.branch}.zip`;
                return (
                  <a
                    href={zipUrl}
                    download
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-700/50 text-zinc-300 hover:bg-zinc-700 text-sm transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    ZIP
                  </a>
                );
              })()}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          {task.status === 'suggested' && (
            <>
              <button
                onClick={() => send('task:approve', { taskId: task.id })}
                className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-medium"
              >
                Approve & Run
              </button>
              <button
                onClick={() => send('task:reject', { taskId: task.id })}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium"
              >
                Reject
              </button>
            </>
          )}
          {(task.status === 'failed' || task.status === 'cancelled') && (
            <button
              onClick={() => send('task:retry', { taskId: task.id })}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium"
            >
              Retry
            </button>
          )}
          {(task.status === 'in_progress' || task.status === 'approved' || task.status === 'queued') && (
            <button
              onClick={() => send('task:cancel', { taskId: task.id })}
              className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium"
            >
              Cancel
            </button>
          )}
        </div>

        {/* Send Follow-up */}
        {task && ['in_review', 'done', 'failed', 'cancelled'].includes(task.status) && (
          <div>
            <h2 className="text-sm font-medium text-cyan-400 mb-2">Send Follow-up</h2>
            <textarea
              value={interactInstruction}
              onChange={(e) => setInteractInstruction(e.target.value)}
              placeholder="e.g., fix the merge conflict, add tests, update the PR description..."
              rows={3}
              className="w-full mb-2 px-3 py-2 text-sm rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 placeholder-zinc-500 focus:outline-none focus:border-cyan-600 resize-none"
            />
            <button
              onClick={() => {
                if (interactInstruction.trim()) {
                  send('task:interact', { taskId: id, instruction: interactInstruction.trim() });
                  setInteractInstruction('');
                }
              }}
              disabled={!interactInstruction.trim()}
              className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-700 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm font-medium transition-colors"
            >
              Send Follow-up
            </button>
          </div>
        )}

        {/* Follow-up History */}
        {logs.filter(l => l.source === 'interaction').length > 0 && (
          <div>
            <h2 className="text-sm font-medium text-cyan-400 mb-2">Follow-up History</h2>
            <div className="space-y-2">
              {logs.filter(l => l.source === 'interaction').map((log, i) => (
                <div key={i} className="bg-cyan-500/10 border border-cyan-500/20 rounded-lg p-3">
                  <p className="text-xs text-zinc-500 mb-1">{new Date(log.timestamp).toLocaleString()}</p>
                  <p className="text-sm text-cyan-300 whitespace-pre-wrap">{log.content}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Move to... override */}
        <div>
          <h2 className="text-sm font-medium text-zinc-400 mb-2">Move to&hellip;</h2>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={selectedOverrideStatus}
              onChange={(e) => setSelectedOverrideStatus(e.target.value)}
              className="px-3 py-1.5 text-sm rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 focus:outline-none focus:border-zinc-600"
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
                  className="px-3 py-1.5 text-sm rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 placeholder-zinc-500 focus:outline-none focus:border-zinc-600"
                />
                <button
                  onClick={() => {
                    send('task:set_status', { taskId: id, status: selectedOverrideStatus, actionedBy: 'Dashboard', reason: overrideReason || undefined });
                    setSelectedOverrideStatus('');
                    setOverrideReason('');
                  }}
                  className="px-4 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium transition-colors"
                >
                  Move to {selectedOverrideStatus.replace('_', ' ')}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Logs */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-medium text-zinc-400">Engineer Logs</h2>
            <button
              onClick={() => send('task:logs', { taskId: id })}
              className="text-xs text-zinc-500 hover:text-zinc-300"
            >
              Refresh
            </button>
          </div>
          <TaskLog logs={logs} />
        </div>
      </div>
    </div>
  );
}
