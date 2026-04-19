'use client';

import { useState, useEffect, useMemo } from 'react';
import { useWs } from '@/components/layout/DashboardShell';
import { usePRStore } from '@/stores/pr-store';
import { PageHeader } from '@/components/ui/PageHeader';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorBanner } from '@/components/ui/ErrorBanner';
import { FilterBar } from '@/components/ui/FilterBar';
import { formatDateTime } from '@/utils/date';
import type { PullRequest, PRReview } from '@/types';

function ReviewBadge({ decision }: { decision?: string }) {
  const colors: Record<string, string> = {
    APPROVED: 'bg-green-500/15 text-green-400 ring-1 ring-green-500/25',
    CHANGES_REQUESTED: 'bg-red-500/15 text-red-400 ring-1 ring-red-500/25',
    REVIEW_REQUIRED: 'bg-yellow-500/15 text-yellow-400 ring-1 ring-yellow-500/25',
  };
  const icons: Record<string, string> = {
    APPROVED: 'M5 13l4 4L19 7',
    CHANGES_REQUESTED: 'M6 18L18 6M6 6l12 12',
    REVIEW_REQUIRED: 'M12 8v4m0 4h.01',
  };
  const label = decision?.replace(/_/g, ' ') || 'REVIEW REQUIRED';
  const iconPath = icons[decision || ''] || icons.REVIEW_REQUIRED;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium ${colors[decision || ''] || 'bg-zinc-700/50 text-zinc-400'}`}>
      <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d={iconPath} />
      </svg>
      {label}
    </span>
  );
}

function ChecksBadge({ status }: { status?: string }) {
  const colors: Record<string, string> = {
    'checks passing': 'text-green-400',
    'checks failing': 'text-red-400',
    'checks running': 'text-yellow-400',
  };
  const dotColors: Record<string, string> = {
    'checks passing': 'bg-green-400',
    'checks failing': 'bg-red-400',
    'checks running': 'bg-yellow-400 animate-pulse',
  };
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] ${colors[status || ''] || 'text-zinc-500'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dotColors[status || ''] || 'bg-zinc-600'}`} />
      {status || 'no checks'}
    </span>
  );
}

function PRCard({ pr, isSelected, onClick }: { pr: PullRequest; isSelected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 border-b border-zinc-800/50 hover:bg-zinc-800/40 transition-all duration-200 ${
        isSelected ? 'bg-zinc-800/60 border-l-2 border-l-indigo-500' : 'border-l-2 border-l-transparent'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-zinc-600 tabular-nums font-mono">#{pr.number}</span>
            <span className="text-sm text-zinc-200 truncate font-medium" title={pr.title}>{pr.title}</span>
          </div>
          <div className="flex items-center gap-2 mt-1.5 text-xs text-zinc-500">
            <span className="font-medium text-zinc-400">{pr.author}</span>
            <span className="text-zinc-700">/</span>
            <span className="truncate font-mono text-[10px]" title={pr.branch}>{pr.branch}</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          <ReviewBadge decision={pr.reviewDecision} />
          <ChecksBadge status={pr.checksStatus} />
        </div>
      </div>
      <div className="flex items-center gap-3 mt-2 text-xs">
        <span className="text-green-400/80 font-mono text-[10px]">+{pr.additions}</span>
        <span className="text-red-400/80 font-mono text-[10px]">-{pr.deletions}</span>
      </div>
    </button>
  );
}

function ReviewItem({ review }: { review: PRReview }) {
  const stateColors: Record<string, string> = {
    APPROVED: 'bg-green-500/10 text-green-400 ring-1 ring-green-500/20',
    CHANGES_REQUESTED: 'bg-red-500/10 text-red-400 ring-1 ring-red-500/20',
    COMMENTED: 'bg-zinc-800/50 text-zinc-400 ring-1 ring-zinc-700',
  };
  const borderColors: Record<string, string> = {
    APPROVED: 'ring-green-500/20',
    CHANGES_REQUESTED: 'ring-red-500/20',
    COMMENTED: 'ring-zinc-800',
  };
  return (
    <div className={`ring-1 ${borderColors[review.state] || 'ring-zinc-800'} rounded-xl p-4 mb-2`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-zinc-200">{review.author}</span>
        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${stateColors[review.state] || 'bg-zinc-800 text-zinc-500'}`}>
          {review.state.replace(/_/g, ' ')}
        </span>
      </div>
      {review.body && (
        <p className="text-xs text-zinc-400 whitespace-pre-wrap leading-relaxed">{review.body.slice(0, 500)}</p>
      )}
      {review.submittedAt && (
        <p className="text-[10px] text-zinc-600 mt-2">
          {formatDateTime(review.submittedAt)}
        </p>
      )}
    </div>
  );
}

const PR_FILTER_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'needs_review', label: 'Needs review' },
  { value: 'approved', label: 'Approved' },
  { value: 'changes', label: 'Changes requested' },
];

const PR_SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'review_first', label: 'Needs review first' },
];

export default function PRReviewsPage() {
  const { send } = useWs();
  const { prs, selectedPR, prDetail, reviewInProgress, lastReviewText, lastReviewRecommendation, error } = usePRStore();
  const [commentText, setCommentText] = useState('');
  const [showDiff, setShowDiff] = useState(false);
  const [addUrl, setAddUrl] = useState('');
  const [addLoading, setAddLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [prFilter, setPrFilter] = useState('all');
  const [prSort, setPrSort] = useState('newest');
  const [prSearch, setPrSearch] = useState('');

  useEffect(() => {
    document.title = 'PR Reviews — CTO Dashboard';
  }, []);

  // Clear loading once store gets data
  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 2000);
    const unsub = usePRStore.subscribe(() => setLoading(false));
    return () => { clearTimeout(timer); unsub(); };
  }, []);

  const handleAddPR = () => {
    const url = addUrl.trim();
    if (!url) return;
    if (!/^https?:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/.test(url)) {
      usePRStore.getState().setError('Invalid GitHub PR URL. Expected format: https://github.com/owner/repo/pull/123');
      return;
    }
    setAddLoading(true);
    send('pr:add', { url });
    setTimeout(() => setAddLoading(false), 10000);
  };

  useEffect(() => {
    const unsub = usePRStore.subscribe((state, prev) => {
      if (state.prs.length > prev.prs.length) {
        setAddLoading(false);
        setAddUrl('');
      }
      if (state.error && state.error !== prev.error) {
        setAddLoading(false);
      }
    });
    return unsub;
  }, []);

  const handleSelectPR = (prNumber: number) => {
    usePRStore.getState().selectPR(prNumber);
    send('pr:detail', { prNumber });
  };

  const handleReview = (prNumber: number) => send('pr:review', { prNumber });
  const handleApprove = (prNumber: number) => send('pr:approve', { prNumber });
  const handleMerge = (prNumber: number) => send('pr:merge', { prNumber, method: 'squash' });

  const handleComment = (prNumber: number) => {
    if (!commentText.trim()) return;
    send('pr:comment', { prNumber, body: commentText.trim() });
    setCommentText('');
  };

  const filteredPRs = useMemo(() => {
    let items = [...prs];
    // Filter
    if (prFilter === 'needs_review') {
      items = items.filter(p => p.reviewDecision === 'REVIEW_REQUIRED' || !p.reviewDecision);
    } else if (prFilter === 'approved') {
      items = items.filter(p => p.reviewDecision === 'APPROVED');
    } else if (prFilter === 'changes') {
      items = items.filter(p => p.reviewDecision === 'CHANGES_REQUESTED');
    }
    // Search
    if (prSearch.trim()) {
      const q = prSearch.toLowerCase();
      items = items.filter(p =>
        p.title.toLowerCase().includes(q) || p.author.toLowerCase().includes(q)
      );
    }
    // Sort
    if (prSort === 'oldest') {
      items.reverse();
    } else if (prSort === 'review_first') {
      items.sort((a, b) => {
        const aNeeds = (!a.reviewDecision || a.reviewDecision === 'REVIEW_REQUIRED') ? 0 : 1;
        const bNeeds = (!b.reviewDecision || b.reviewDecision === 'REVIEW_REQUIRED') ? 0 : 1;
        return aNeeds - bNeeds;
      });
    }
    return items;
  }, [prs, prFilter, prSort, prSearch]);

  return (
    <div className="h-full flex flex-col">
      <PageHeader
        title="PR Reviews"
        actions={
          <>
            <input
              type="text"
              value={addUrl}
              onChange={(e) => setAddUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddPR()}
              placeholder="Paste GitHub PR URL..."
              className="flex-1 max-w-sm text-xs bg-zinc-800 text-zinc-200 px-3 py-1.5 rounded-lg border border-zinc-700 focus:border-blue-500 focus:outline-none placeholder-zinc-600"
            />
            <button
              onClick={handleAddPR}
              disabled={addLoading || !addUrl.trim()}
              className="text-xs text-zinc-400 hover:text-zinc-300 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 transition-colors"
            >
              {addLoading ? (
                <span className="flex items-center gap-1.5">
                  <Spinner size="sm" />
                  Adding...
                </span>
              ) : 'Add'}
            </button>
            <span className="text-xs text-zinc-500">{prs.length} open</span>
            <button
              onClick={() => send('pr:list')}
              className="text-xs text-zinc-400 hover:text-zinc-300 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 transition-colors"
            >
              Refresh
            </button>
          </>
        }
      />

      {error && <ErrorBanner message={error} onDismiss={() => usePRStore.getState().setError(null)} />}

      <div className="flex-1 overflow-hidden flex">
        {/* PR List (left panel) */}
        <div className="w-64 lg:w-80 flex-shrink-0 border-r border-zinc-800 flex flex-col">
          <div className="p-2 border-b border-zinc-800">
            <FilterBar
              filters={PR_FILTER_OPTIONS}
              activeFilter={prFilter}
              onFilterChange={setPrFilter}
              searchPlaceholder="Search PRs..."
              searchValue={prSearch}
              onSearchChange={setPrSearch}
              sortOptions={PR_SORT_OPTIONS}
              activeSort={prSort}
              onSortChange={setPrSort}
            />
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Spinner size="md" />
              </div>
            ) : filteredPRs.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  icon="\u{1F500}"
                  title="No Pull Requests"
                  description={prs.length === 0 ? 'Paste a PR URL above to track it.' : 'No PRs match your filters.'}
                />
              </div>
            ) : (
              filteredPRs.map(pr => (
                <PRCard
                  key={pr.number}
                  pr={pr}
                  isSelected={selectedPR === pr.number}
                  onClick={() => handleSelectPR(pr.number)}
                />
              ))
            )}
          </div>
        </div>

        {/* Detail panel (right) */}
        <div className="flex-1 overflow-y-auto">
          {!selectedPR ? (
            <EmptyState
              icon="\u{1F448}"
              title="No PR Selected"
              description="Select a pull request from the list to view its details."
            />
          ) : !prDetail ? (
            <div className="flex items-center justify-center h-full">
              <Spinner size="lg" />
            </div>
          ) : (
            <div className="p-4 space-y-4">
              {/* PR Header */}
              <div>
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <h2 className="text-lg font-semibold text-zinc-200">
                      #{prDetail.pr.number} {prDetail.pr.title}
                    </h2>
                    <div className="flex items-center gap-3 mt-1 text-xs text-zinc-500 flex-wrap">
                      <span>{prDetail.pr.author}</span>
                      <span className="truncate" title={`${prDetail.pr.branch} → ${prDetail.pr.baseBranch}`}>{prDetail.pr.branch} &rarr; {prDetail.pr.baseBranch}</span>
                      <span className="text-green-400">+{prDetail.pr.additions}</span>
                      <span className="text-red-400">-{prDetail.pr.deletions}</span>
                      <ChecksBadge status={prDetail.pr.checksStatus} />
                      <ReviewBadge decision={prDetail.pr.reviewDecision} />
                    </div>
                  </div>
                  <a
                    href={prDetail.pr.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-400 hover:text-blue-300 flex-shrink-0"
                  >
                    Open on GitHub
                  </a>
                </div>

                {prDetail.pr.body && (
                  <div className="mt-3 p-3 bg-zinc-800/50 rounded-lg text-xs text-zinc-300 whitespace-pre-wrap max-h-40 overflow-y-auto">
                    {prDetail.pr.body}
                  </div>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => handleReview(prDetail.pr.number)}
                  disabled={reviewInProgress === prDetail.pr.number}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-500 disabled:ring-1 disabled:ring-zinc-700 text-white text-xs font-medium rounded-lg transition-all duration-200 shadow-sm hover:shadow-indigo-500/20"
                >
                  {reviewInProgress === prDetail.pr.number ? (
                    <span className="flex items-center gap-1.5">
                      <Spinner size="sm" />
                      CTO Reviewing...
                    </span>
                  ) : 'Request CTO Review'}
                </button>
                <button
                  onClick={() => handleApprove(prDetail.pr.number)}
                  className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white text-xs font-medium rounded-lg transition-all duration-200 shadow-sm hover:shadow-green-500/20"
                >
                  Approve
                </button>
                <button
                  onClick={() => handleMerge(prDetail.pr.number)}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-medium rounded-lg transition-all duration-200 shadow-sm hover:shadow-purple-500/20"
                >
                  Merge (Squash)
                </button>
                <button
                  onClick={() => setShowDiff(!showDiff)}
                  className="px-4 py-2 ring-1 ring-zinc-700 hover:ring-zinc-600 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium rounded-lg transition-all duration-200"
                >
                  {showDiff ? 'Hide Diff' : 'Show Diff'}
                </button>
              </div>

              {/* CTO Review Result */}
              {lastReviewText && selectedPR === prDetail.pr.number && (
                <div className="border border-zinc-700 rounded-lg overflow-hidden">
                  <div className="px-3 py-2 bg-zinc-800 border-b border-zinc-700 flex items-center justify-between">
                    <span className="text-xs font-medium text-zinc-300">CTO Review</span>
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                      lastReviewRecommendation === 'APPROVE' ? 'bg-green-600' :
                      lastReviewRecommendation === 'REQUEST_CHANGES' ? 'bg-red-600' : 'bg-zinc-600'
                    }`}>
                      {lastReviewRecommendation}
                    </span>
                  </div>
                  <div className="p-3 text-xs text-zinc-300 whitespace-pre-wrap max-h-96 overflow-y-auto">
                    {lastReviewText}
                  </div>
                </div>
              )}

              {/* Diff viewer */}
              {showDiff && prDetail.diff && (
                <div className="ring-1 ring-zinc-700 rounded-xl overflow-hidden">
                  <div className="px-4 py-2.5 bg-zinc-800/80 border-b border-zinc-700 flex items-center justify-between">
                    <span className="text-xs font-semibold text-zinc-200">Diff</span>
                    <span className="text-[10px] text-zinc-500">{prDetail.diff.split('\n').length} lines</span>
                  </div>
                  <div className="max-h-[500px] overflow-y-auto overflow-x-auto">
                    <pre className="text-[11px] font-mono leading-relaxed">
                      {prDetail.diff.split('\n').map((line, i) => {
                        let color = 'text-zinc-400';
                        let bg = '';
                        if (line.startsWith('+') && !line.startsWith('+++')) { color = 'text-green-300'; bg = 'bg-green-500/5'; }
                        else if (line.startsWith('-') && !line.startsWith('---')) { color = 'text-red-300'; bg = 'bg-red-500/5'; }
                        else if (line.startsWith('@@')) { color = 'text-blue-400'; bg = 'bg-blue-500/5'; }
                        else if (line.startsWith('diff --git')) { color = 'text-zinc-200 font-semibold'; bg = 'bg-zinc-800/60'; }
                        return (
                          <div key={i} className={`${color} ${bg} px-4 py-px flex`}>
                            <span className="text-zinc-700 w-10 flex-shrink-0 text-right pr-3 select-none">{i + 1}</span>
                            <span className="flex-1">{line || ' '}</span>
                          </div>
                        );
                      })}
                    </pre>
                  </div>
                </div>
              )}

              {/* Existing reviews */}
              {prDetail.reviews.length > 0 && (
                <div>
                  <h3 className="text-xs font-medium text-zinc-400 mb-2">Reviews ({prDetail.reviews.length})</h3>
                  {prDetail.reviews.map((review, i) => (
                    <ReviewItem key={i} review={review} />
                  ))}
                </div>
              )}

              {/* Comment input */}
              <div className="ring-1 ring-zinc-700 rounded-xl overflow-hidden">
                <textarea
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder="Add a comment..."
                  className="w-full bg-zinc-900 text-zinc-200 text-xs p-4 resize-none h-20 focus:outline-none placeholder-zinc-600 focus:ring-1 focus:ring-indigo-500/30 transition-all duration-200"
                />
                <div className="px-4 py-2.5 bg-zinc-800/80 border-t border-zinc-700 flex justify-end">
                  <button
                    onClick={() => handleComment(prDetail.pr.number)}
                    disabled={!commentText.trim()}
                    className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-600 disabled:cursor-not-allowed text-white text-xs font-medium rounded-lg transition-all duration-200"
                  >
                    Comment
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
