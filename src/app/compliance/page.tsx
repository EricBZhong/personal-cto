'use client';

import { useEffect, useState } from 'react';
import { useWs } from '@/components/layout/DashboardShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorBanner } from '@/components/ui/ErrorBanner';

interface ComplianceCategory {
  name: string;
  passing: number;
  failing: number;
  total: number;
  pct: number;
}

interface FailingControl {
  id: string;
  name: string;
  category: string;
  status: string;
  description?: string;
  remediationNote?: string;
}

const categoryIcons: Record<string, string> = {
  'Security': '🔒',
  'Availability': '🟢',
  'Confidentiality': '🔐',
  'Processing Integrity': '⚙️',
  'Privacy': '👁️',
};

function getScoreColor(pct: number): { text: string; bg: string; ring: string; gradient: string } {
  if (pct >= 80) return { text: 'text-emerald-400', bg: 'bg-emerald-500', ring: 'ring-emerald-500/20', gradient: 'from-emerald-500 to-emerald-400' };
  if (pct >= 50) return { text: 'text-yellow-400', bg: 'bg-yellow-500', ring: 'ring-yellow-500/20', gradient: 'from-yellow-500 to-yellow-400' };
  return { text: 'text-red-400', bg: 'bg-red-500', ring: 'ring-red-500/20', gradient: 'from-red-500 to-red-400' };
}

export default function CompliancePage() {
  const { send, connected } = useWs();
  const [categories, setCategories] = useState<ComplianceCategory[]>([]);
  const [overallScore, setOverallScore] = useState(0);
  const [failingControls, setFailingControls] = useState<FailingControl[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isConfigured, setIsConfigured] = useState(true);

  useEffect(() => {
    if (connected) {
      send('compliance:overview');
      send('compliance:failing');
    }
  }, [connected, send]);

  useEffect(() => {
    const overviewHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail.categories) setCategories(detail.categories);
      if (detail.overallScore !== undefined) setOverallScore(detail.overallScore);
      if (detail.error) {
        if (detail.error.toLowerCase().includes('not configured') || detail.error.toLowerCase().includes('api key')) {
          setIsConfigured(false);
        }
        setError(detail.error);
      } else {
        setError(null);
      }
      setLoading(false);
    };
    const failingHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail.controls) setFailingControls(detail.controls);
      if (detail.error) setError(detail.error);
      setLoading(false);
    };
    window.addEventListener('compliance:overview', overviewHandler);
    window.addEventListener('compliance:failing', failingHandler);
    return () => {
      window.removeEventListener('compliance:overview', overviewHandler);
      window.removeEventListener('compliance:failing', failingHandler);
    };
  }, []);

  useEffect(() => {
    document.title = 'Compliance — CTO Dashboard';
  }, []);

  const scoreColor = getScoreColor(overallScore);

  return (
    <div className="h-full flex flex-col">
      <PageHeader
        title="SOC 2 Compliance"
        subtitle="Vanta integration for audit readiness"
        actions={
          <>
            <button
              onClick={() => {
                setLoading(true);
                send('compliance:overview');
                send('compliance:failing');
              }}
              className="text-xs text-zinc-400 hover:text-zinc-200 px-3.5 py-1.5 rounded-lg bg-zinc-800/80 ring-1 ring-zinc-700/50 hover:bg-zinc-700/80 hover:ring-zinc-600/50 transition-all duration-200"
            >
              Refresh
            </button>
            <button
              onClick={() => send('analysis:run', { focus: 'SOC 2 compliance gaps — security controls, logging, encryption, access management' })}
              className="text-xs text-indigo-400 hover:text-indigo-300 px-3.5 py-1.5 rounded-lg bg-indigo-500/10 ring-1 ring-indigo-500/20 hover:bg-indigo-500/20 hover:ring-indigo-500/30 transition-all duration-200 font-medium"
            >
              Run Compliance Audit
            </button>
          </>
        }
      />

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Spinner size="lg" />
          </div>
        ) : !isConfigured && categories.every(c => c.total === 0) ? (
          <EmptyState
            icon="\u{1F6E1}\uFE0F"
            title="Vanta Not Configured"
            description="Add your Vanta API key in Settings to connect SOC 2 compliance monitoring."
            action={{ label: 'Go to Settings', href: '/settings' }}
          />
        ) : (
          <div className="max-w-5xl mx-auto p-6 space-y-6">
            {/* Overall Score */}
            <div className="bg-zinc-900/60 rounded-xl ring-1 ring-zinc-800/50 p-8">
              <div className="text-center">
                <div className={`text-6xl font-bold tabular-nums ${scoreColor.text}`}>{overallScore}%</div>
                <div className="text-sm text-zinc-500 mt-2 font-medium">Overall Compliance Score</div>
                <div className="w-48 mx-auto mt-4 h-2 bg-zinc-800/50 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full bg-gradient-to-r ${scoreColor.gradient} transition-all duration-700 ease-out`}
                    style={{ width: `${overallScore}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Trust Service Criteria */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {(categories.length > 0 ? categories : defaultCategories).map((cat) => {
                const colors = getScoreColor(cat.pct);
                const icon = categoryIcons[cat.name] || '📋';
                return (
                  <div key={cat.name} className="bg-zinc-900/60 rounded-xl ring-1 ring-zinc-800/50 p-4 card-hover">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2.5">
                        <span className="text-base">{icon}</span>
                        <h3 className="text-sm font-medium text-zinc-300">{cat.name}</h3>
                      </div>
                      <span className={`text-lg font-bold tabular-nums ${colors.text}`}>
                        {cat.pct}%
                      </span>
                    </div>
                    <div className="w-full bg-zinc-800/50 rounded-full h-2 overflow-hidden">
                      <div
                        className={`h-2 rounded-full bg-gradient-to-r ${colors.gradient} transition-all duration-500 ease-out`}
                        style={{ width: `${cat.pct}%` }}
                      />
                    </div>
                    <div className="flex justify-between mt-2.5 text-xs text-zinc-500">
                      <span className="text-emerald-400/70">{cat.passing} passing</span>
                      <span className={cat.failing > 0 ? 'text-red-400/70' : ''}>{cat.failing} failing</span>
                      <span>{cat.total} total</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Failing Controls */}
            <div>
              <h2 className="text-sm font-medium text-zinc-300 mb-3 flex items-center gap-2">
                <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                Failing Controls
              </h2>
              {failingControls.length === 0 ? (
                <div className="bg-zinc-900/60 rounded-xl ring-1 ring-zinc-800/50 p-10 text-center text-zinc-500 text-sm">
                  {connected ? 'No failing controls found.' : 'Connecting...'}
                </div>
              ) : (
                <div className="space-y-2">
                  {failingControls.map((control) => (
                    <div key={control.id} className="bg-zinc-900/60 rounded-xl ring-1 ring-zinc-800/50 p-4 card-hover">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="text-sm font-medium text-zinc-200" title={control.name}>{control.name}</h3>
                          <span className="text-xs text-zinc-500">{control.category}</span>
                        </div>
                        <span className="text-xs px-2.5 py-0.5 rounded-md bg-red-500/10 text-red-400 ring-1 ring-red-500/20 flex-shrink-0 font-medium">
                          Failing
                        </span>
                      </div>
                      {control.description && (
                        <p className="text-xs text-zinc-400 mt-2 leading-relaxed">{control.description}</p>
                      )}
                      {control.remediationNote && (
                        <p className="text-xs text-amber-400/80 mt-1.5 leading-relaxed">Remediation: {control.remediationNote}</p>
                      )}
                      <button
                        onClick={() => send('chat:send', {
                          message: `Create a task to fix this SOC 2 control: "${control.name}" (${control.category}). ${control.remediationNote || control.description || ''}`
                        })}
                        className="mt-2.5 text-xs text-indigo-400 hover:text-indigo-300 font-medium transition-colors duration-200"
                      >
                        Ask CTO to fix this
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Quick Actions */}
            <div className="bg-zinc-900/60 rounded-xl ring-1 ring-zinc-800/50 p-5">
              <h2 className="text-sm font-medium text-zinc-300 mb-3 flex items-center gap-2">
                <svg className="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Quick Actions
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                {[
                  { label: 'Audit Access Controls', prompt: 'Audit all access controls in the codebase — check auth middleware, RBAC, API key management', icon: '🔑' },
                  { label: 'Check Encryption', prompt: 'Verify encryption at rest and in transit — check TLS, DuckDB encryption, secrets management', icon: '🔒' },
                  { label: 'Review Logging', prompt: 'Review logging practices for SOC 2 — check audit trails, error logging, PII redaction', icon: '📝' },
                  { label: 'Verify Change Mgmt', prompt: 'Verify change management controls — PR reviews, deploy approvals, rollback procedures', icon: '🔄' },
                ].map((action) => (
                  <button
                    key={action.label}
                    onClick={() => send('chat:send', { message: action.prompt })}
                    className="flex items-start gap-2.5 text-xs px-3.5 py-2.5 rounded-xl bg-zinc-800/60 ring-1 ring-zinc-700/40 text-zinc-300 hover:bg-zinc-700/60 hover:text-white hover:ring-zinc-600/50 transition-all duration-200 text-left"
                  >
                    <span className="text-sm mt-px flex-shrink-0">{action.icon}</span>
                    <span className="font-medium leading-relaxed">{action.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const defaultCategories: ComplianceCategory[] = [
  { name: 'Security', passing: 0, failing: 0, total: 0, pct: 0 },
  { name: 'Availability', passing: 0, failing: 0, total: 0, pct: 0 },
  { name: 'Confidentiality', passing: 0, failing: 0, total: 0, pct: 0 },
  { name: 'Processing Integrity', passing: 0, failing: 0, total: 0, pct: 0 },
  { name: 'Privacy', passing: 0, failing: 0, total: 0, pct: 0 },
];
