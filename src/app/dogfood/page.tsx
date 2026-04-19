'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useWs } from '@/components/layout/DashboardShell';
import { useDogfoodStore, type EvalDefinition, type DogfoodLiveLog, type DogfoodLiveScreenshot } from '@/stores/dogfood-store';
import { formatDateTime } from '@/utils/date';
import type { DogfoodResult, DogfoodScreenshot } from '@/types';

const TEST_TYPES = [
  {
    id: 'backend-latency',
    label: 'Backend Latency',
    description: 'Health check + auth endpoint latency',
    icon: '🏓',
    requiresBrowser: false,
  },
  {
    id: 'visual-inspection',
    label: 'Visual Inspection',
    description: 'Launch Chrome with extension, take screenshots at different viewports',
    icon: '👁️',
    requiresBrowser: true,
  },
  {
    id: 'chat-latency',
    label: 'Chat Latency',
    description: 'Send a message through the extension and measure TTFT + full response time',
    icon: '⏱️',
    requiresBrowser: true,
  },
  {
    id: 'proactive-exploration',
    label: 'Proactive Exploration',
    description: 'Autonomously test edge cases: Unicode, XSS, rapid-fire, resize, long inputs, etc.',
    icon: '🔍',
    requiresBrowser: true,
  },
  {
    id: 'full-suite',
    label: 'Full Suite',
    description: 'Run all tests sequentially including proactive exploration',
    icon: '🔄',
    requiresBrowser: true,
  },
];

const CATEGORY_COLORS: Record<string, string> = {
  functional: 'bg-blue-500/20 text-blue-400',
  'edge-case': 'bg-amber-500/20 text-amber-400',
  performance: 'bg-green-500/20 text-green-400',
  accessibility: 'bg-purple-500/20 text-purple-400',
  security: 'bg-red-500/20 text-red-400',
};

function StatusBadge({ success }: { success: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ring-1 ${
      success
        ? 'bg-green-500/15 text-green-400 ring-green-500/25'
        : 'bg-red-500/15 text-red-400 ring-red-500/25'
    }`}>
      <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
          d={success ? 'M5 13l4 4L19 7' : 'M6 18L18 6M6 6l12 12'} />
      </svg>
      {success ? 'PASS' : 'FAIL'}
    </span>
  );
}

function ScreenshotGallery({ screenshots }: { screenshots: DogfoodScreenshot[] }) {
  const [selected, setSelected] = useState<number | null>(null);
  if (screenshots.length === 0) return null;

  return (
    <div className="mt-3">
      <h4 className="text-xs font-medium text-zinc-400 mb-2">Screenshots ({screenshots.length})</h4>
      <div className="grid grid-cols-3 gap-2">
        {screenshots.map((ss, i) => (
          <button
            key={i}
            onClick={() => setSelected(selected === i ? null : i)}
            className={`relative rounded-lg overflow-hidden border transition-all ${
              selected === i ? 'border-blue-500 ring-1 ring-blue-500' : 'border-zinc-700 hover:border-zinc-500'
            }`}
          >
            {ss.base64 ? (
              <img src={ss.base64} alt={ss.label} className="w-full h-24 object-cover" />
            ) : (
              <div className="w-full h-24 bg-zinc-800 flex items-center justify-center text-xs text-zinc-500">No image</div>
            )}
            <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-xs text-zinc-300 px-1.5 py-0.5 truncate">
              {ss.label}
            </div>
          </button>
        ))}
      </div>
      {selected !== null && screenshots[selected]?.base64 && (
        <div className="mt-3 rounded-lg border border-zinc-700 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-800 border-b border-zinc-700">
            <span className="text-xs text-zinc-300">{screenshots[selected].label}</span>
            <button onClick={() => setSelected(null)} className="text-xs text-zinc-500 hover:text-zinc-300">Close</button>
          </div>
          <img src={screenshots[selected].base64} alt={screenshots[selected].label} className="w-full" />
        </div>
      )}
    </div>
  );
}

function ResultCard({ result }: { result: DogfoodResult }) {
  const [expanded, setExpanded] = useState(false);
  const screenshots = (result.screenshots || []) as unknown as DogfoodScreenshot[];

  return (
    <div className="bg-zinc-900 rounded-xl ring-1 ring-zinc-800 overflow-hidden hover:ring-zinc-700 transition-all duration-200">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-zinc-800/40 transition-all duration-200"
      >
        <div className="flex items-center gap-3">
          <StatusBadge success={result.success} />
          <span className="text-sm font-semibold text-zinc-100">{result.testName}</span>
          <span className="text-xs text-zinc-500 tabular-nums font-mono">{result.duration_ms}ms</span>
        </div>
        <div className="flex items-center gap-3">
          {result.ttft_ms != null && <span className="text-xs text-zinc-400 tabular-nums">TTFT: {result.ttft_ms}ms</span>}
          {result.full_response_ms != null && <span className="text-xs text-zinc-400 tabular-nums">Full: {result.full_response_ms}ms</span>}
          <span className={`text-zinc-500 text-xs transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}>&#9660;</span>
        </div>
      </button>
      {expanded && (
        <div className="px-4 pb-4 border-t border-zinc-800">
          {Object.keys(result.metrics).length > 0 && (
            <div className="mt-3">
              <h4 className="text-xs font-medium text-zinc-400 mb-1.5">Metrics</h4>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                {Object.entries(result.metrics).map(([key, val]) => (
                  <div key={key} className="flex justify-between text-xs">
                    <span className="text-zinc-500">{key}</span>
                    <span className="text-zinc-300 font-mono">{val}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {result.logs.length > 0 && (
            <div className="mt-3">
              <h4 className="text-xs font-medium text-zinc-400 mb-1.5">Logs</h4>
              <div className="bg-zinc-950 rounded p-2 max-h-40 overflow-y-auto font-mono text-xs text-zinc-400 space-y-0.5">
                {result.logs.map((log, i) => <div key={i}>{log}</div>)}
              </div>
            </div>
          )}
          {result.errors.length > 0 && (
            <div className="mt-3">
              <h4 className="text-xs font-medium text-red-400 mb-1.5">Errors</h4>
              <div className="bg-red-500/10 rounded p-2 text-xs text-red-300 space-y-1">
                {result.errors.map((err, i) => <div key={i}>{err}</div>)}
              </div>
            </div>
          )}
          <ScreenshotGallery screenshots={screenshots} />
        </div>
      )}
    </div>
  );
}

function EvalCard({ eval_, onDelete, onRun, running }: { eval_: EvalDefinition; onDelete: () => void; onRun: () => void; running: boolean }) {
  return (
    <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-3">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-zinc-200">{eval_.name}</span>
            <span className={`text-xs px-1.5 py-0.5 rounded ${CATEGORY_COLORS[eval_.category] || 'bg-zinc-700 text-zinc-400'}`}>
              {eval_.category}
            </span>
            {eval_.createdBy === 'cto' && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400">CTO</span>
            )}
          </div>
          <p className="text-xs text-zinc-500 mt-0.5">{eval_.description}</p>
          <p className="text-xs text-zinc-600 mt-1 font-mono truncate">&quot;{eval_.input}&quot;</p>
          <div className="flex gap-3 mt-1 text-xs text-zinc-600">
            {eval_.maxTtftMs && <span>Max TTFT: {eval_.maxTtftMs}ms</span>}
            {eval_.expectedBehavior && <span>Expects: &quot;{eval_.expectedBehavior}&quot;</span>}
          </div>
        </div>
        <div className="flex gap-1 ml-2 flex-shrink-0">
          <button
            onClick={onRun}
            disabled={running}
            className="text-xs px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40"
          >
            Run
          </button>
          <button
            onClick={onDelete}
            className="text-xs px-2 py-1 rounded bg-zinc-800 hover:bg-red-500/20 text-zinc-400 hover:text-red-400"
          >
            Del
          </button>
        </div>
      </div>
    </div>
  );
}

function CreateEvalForm({ onSubmit }: { onSubmit: (data: Record<string, unknown>) => void }) {
  const [name, setName] = useState('');
  const [input, setInput] = useState('');
  const [category, setCategory] = useState('functional');
  const [description, setDescription] = useState('');
  const [expectedBehavior, setExpectedBehavior] = useState('');
  const [maxTtft, setMaxTtft] = useState('');

  const handleSubmit = () => {
    if (!name.trim() || !input.trim()) return;
    onSubmit({
      name: name.trim(),
      input: input.trim(),
      category,
      description: description.trim(),
      expectedBehavior: expectedBehavior.trim() || undefined,
      maxTtftMs: maxTtft ? parseInt(maxTtft) : undefined,
      expectNoErrors: true,
    });
    setName(''); setInput(''); setDescription(''); setExpectedBehavior(''); setMaxTtft('');
  };

  return (
    <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4 space-y-3">
      <h3 className="text-sm font-medium text-zinc-300">Create Custom Eval</h3>
      <div className="grid grid-cols-2 gap-3">
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Eval name"
          className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600"
        />
        <select
          value={category}
          onChange={e => setCategory(e.target.value)}
          className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200"
        >
          <option value="functional">Functional</option>
          <option value="edge-case">Edge Case</option>
          <option value="performance">Performance</option>
          <option value="security">Security</option>
          <option value="accessibility">Accessibility</option>
        </select>
      </div>
      <textarea
        value={input}
        onChange={e => setInput(e.target.value)}
        placeholder="Message to send to the extension (the test input)"
        rows={2}
        className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600 resize-none"
      />
      <input
        value={description}
        onChange={e => setDescription(e.target.value)}
        placeholder="Description (what this tests)"
        className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600"
      />
      <div className="grid grid-cols-2 gap-3">
        <input
          value={expectedBehavior}
          onChange={e => setExpectedBehavior(e.target.value)}
          placeholder="Expected in response (optional)"
          className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600"
        />
        <input
          value={maxTtft}
          onChange={e => setMaxTtft(e.target.value)}
          placeholder="Max TTFT ms (optional)"
          type="number"
          className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600"
        />
      </div>
      <button
        onClick={handleSubmit}
        disabled={!name.trim() || !input.trim()}
        className="text-xs font-medium px-4 py-1.5 rounded-lg bg-green-600 hover:bg-green-500 text-white transition-colors disabled:opacity-40"
      >
        Add Eval
      </button>
    </div>
  );
}

const ETA_ESTIMATES: Record<string, string> = {
  'backend-latency': '~5 seconds',
  'visual-inspection': '~30 seconds',
  'chat-latency': '~1-2 minutes',
  'proactive-exploration': '~3-5 minutes',
  'full-suite': '~5-8 minutes',
  'eval-suite': 'depends on eval count',
  'eval-generation': '~30-60 seconds',
  'eval-import': '~30-60 seconds',
};

function LiveTestPanel({ testType, withAnalysis, evalDuration, liveLogs, liveScreenshots, currentStep, onCancel }: {
  testType: string | null;
  withAnalysis: boolean;
  evalDuration: number;
  liveLogs: DogfoodLiveLog[];
  liveScreenshots: DogfoodLiveScreenshot[];
  currentStep: string | null;
  onCancel: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(Date.now());
  const logEndRef = useRef<HTMLDivElement>(null);
  const [expandedScreenshot, setExpandedScreenshot] = useState<number | null>(null);
  const testStartTime = useRef(Date.now());

  useEffect(() => {
    startRef.current = Date.now();
    testStartTime.current = Date.now();
    setElapsed(0);
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [testType]);

  // Auto-scroll logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [liveLogs]);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  const formatDelta = useCallback((ts: number) => {
    const delta = (ts - testStartTime.current) / 1000;
    return delta.toFixed(1);
  }, []);

  const hasLiveData = liveLogs.length > 0 || liveScreenshots.length > 0;

  // For eval-suite or when no live data, show simple indicator
  if (testType === 'eval-suite' || !hasLiveData) {
    return (
      <div className="bg-indigo-500/10 ring-1 ring-indigo-500/20 rounded-xl p-4 flex items-center gap-4">
        <div className="w-5 h-5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-indigo-300">
              Running {testType}...
              {withAnalysis && <span className="text-purple-300 ml-1">(+ CTO analysis)</span>}
            </p>
            <span className="text-xs text-zinc-500 font-mono tabular-nums bg-zinc-800/50 px-1.5 py-0.5 rounded">{formatTime(elapsed)}</span>
          </div>
          <p className="text-xs text-zinc-500 mt-1">
            {testType === 'eval-suite'
              ? `Running evals with ${evalDuration} minute time limit.`
              : `Estimated: ${ETA_ESTIMATES[testType || ''] || '~30 seconds'}`}
          </p>
        </div>
        <button
          onClick={onCancel}
          className="text-xs font-medium px-3.5 py-1.5 rounded-lg bg-red-500/15 ring-1 ring-red-500/25 hover:bg-red-500/25 text-red-400 hover:text-red-300 transition-all duration-200 flex-shrink-0"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="bg-zinc-900 rounded-xl ring-1 ring-zinc-800 overflow-hidden">
      {/* Status bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-indigo-500/10 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <div className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
          <span className="text-xs font-mono tabular-nums text-indigo-300 bg-indigo-500/20 px-2 py-0.5 rounded">{formatTime(elapsed)}</span>
          {currentStep && (
            <span className="text-sm text-zinc-300">{currentStep}</span>
          )}
          {withAnalysis && <span className="text-xs text-purple-400">(+ CTO analysis)</span>}
        </div>
        <button
          onClick={onCancel}
          className="text-xs font-medium px-3 py-1.5 rounded-lg bg-red-500/15 ring-1 ring-red-500/25 hover:bg-red-500/25 text-red-400 hover:text-red-300 transition-all duration-200"
        >
          Cancel
        </button>
      </div>

      {/* Content: logs + screenshots */}
      <div className="flex min-h-[200px] max-h-[400px]">
        {/* Progress steps (left) */}
        <div className="flex-1 border-r border-zinc-800 overflow-y-auto p-3">
          <div className="space-y-0.5 font-mono text-xs">
            {liveLogs.map((entry, i) => {
              const isStep = !!entry.step;
              const isCurrentStep = isStep && i === liveLogs.length - 1;
              return (
                <div key={i} className="flex gap-2">
                  <span className="text-zinc-600 tabular-nums flex-shrink-0 w-12 text-right">[{formatDelta(entry.timestamp)}s]</span>
                  {isStep ? (
                    <span className={isCurrentStep ? 'text-green-400' : 'text-zinc-400'}>
                      {isCurrentStep && <span className="mr-1">&gt;</span>}
                      {entry.step}
                    </span>
                  ) : (
                    <span className="text-zinc-500 pl-2">{entry.log}</span>
                  )}
                </div>
              );
            })}
            <div ref={logEndRef} />
          </div>
        </div>

        {/* Live screenshots (right) */}
        {liveScreenshots.length > 0 && (
          <div className="w-[280px] flex-shrink-0 overflow-y-auto p-3">
            <h4 className="text-xs font-medium text-zinc-400 mb-2">Screenshots ({liveScreenshots.length})</h4>
            {/* Latest screenshot large */}
            <button
              onClick={() => setExpandedScreenshot(
                expandedScreenshot === liveScreenshots.length - 1 ? null : liveScreenshots.length - 1
              )}
              className="w-full rounded-lg overflow-hidden border border-zinc-700 hover:border-zinc-500 transition-all mb-2"
            >
              <img
                src={liveScreenshots[liveScreenshots.length - 1].base64}
                alt={liveScreenshots[liveScreenshots.length - 1].label}
                className="w-full h-auto"
              />
              <div className="bg-black/70 text-xs text-zinc-300 px-2 py-1 truncate">
                {liveScreenshots[liveScreenshots.length - 1].label}
              </div>
            </button>
            {/* Previous screenshots as thumbnails */}
            {liveScreenshots.length > 1 && (
              <div className="grid grid-cols-3 gap-1">
                {liveScreenshots.slice(0, -1).map((ss, i) => (
                  <button
                    key={i}
                    onClick={() => setExpandedScreenshot(expandedScreenshot === i ? null : i)}
                    className={`rounded overflow-hidden border transition-all ${
                      expandedScreenshot === i ? 'border-blue-500 ring-1 ring-blue-500' : 'border-zinc-700 hover:border-zinc-500'
                    }`}
                  >
                    <img src={ss.base64} alt={ss.label} className="w-full h-14 object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Expanded screenshot */}
      {expandedScreenshot !== null && liveScreenshots[expandedScreenshot] && (
        <div className="border-t border-zinc-800">
          <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-800">
            <span className="text-xs text-zinc-300">{liveScreenshots[expandedScreenshot].label}</span>
            <button onClick={() => setExpandedScreenshot(null)} className="text-xs text-zinc-500 hover:text-zinc-300">Close</button>
          </div>
          <img src={liveScreenshots[expandedScreenshot].base64} alt={liveScreenshots[expandedScreenshot].label} className="w-full" />
        </div>
      )}
    </div>
  );
}

function ImportEvalsForm({ onImport, running }: { onImport: (content: string) => void; running: boolean }) {
  const [content, setContent] = useState('');
  const [dragOver, setDragOver] = useState(false);

  const handleFileRead = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (text) setContent(text);
    };
    reader.readAsText(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileRead(file);
  };

  return (
    <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4 space-y-3">
      <div>
        <h3 className="text-sm font-medium text-zinc-300">Import Evals</h3>
        <p className="text-xs text-zinc-500 mt-0.5">
          Paste or drop any format — CSV, JSON, plain text, spreadsheet data, markdown table, etc.
          The CTO will parse it and create eval definitions.
        </p>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`relative ${dragOver ? 'ring-2 ring-blue-500' : ''}`}
      >
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          placeholder={`Paste your evals here in any format, e.g.:\n\n1. Ask "What are my open opportunities?" - should mention opportunity data\n2. Send Chinese text "显示管道" - should not error\n3. XSS test: <script>alert(1)</script> - should be sanitized\n\n...or drop a file (CSV, JSON, TXT, etc.)`}
          rows={8}
          className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 resize-y font-mono"
        />
        {dragOver && (
          <div className="absolute inset-0 bg-blue-500/10 border-2 border-dashed border-blue-500 rounded flex items-center justify-center">
            <span className="text-sm text-blue-300">Drop file here</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <label className="text-xs font-medium px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 cursor-pointer transition-colors">
          Upload File
          <input
            type="file"
            accept=".csv,.json,.txt,.md,.yaml,.yml,.tsv,.xlsx"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileRead(file);
            }}
          />
        </label>
        <button
          onClick={() => { onImport(content); setContent(''); }}
          disabled={!content.trim() || running}
          className="text-xs font-medium px-4 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white transition-colors disabled:opacity-40"
        >
          {running ? 'CTO is parsing...' : 'Import via CTO'}
        </button>
        {content && (
          <span className="text-xs text-zinc-500">{content.length} chars</span>
        )}
      </div>
    </div>
  );
}

export default function DogfoodPage() {
  const { send, connected } = useWs();
  const { running, testType, withAnalysis, results, report, error, history, evals, evalHistory, importResult, liveLogs, liveScreenshots, currentStep } = useDogfoodStore();
  const [activeTab, setActiveTab] = useState<'tests' | 'evals'>('tests');
  const [showHistory, setShowHistory] = useState(false);
  const [showCreateEval, setShowCreateEval] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [evalDuration, setEvalDuration] = useState(10);
  const [showExtConfig, setShowExtConfig] = useState(false);
  const [extPath, setExtPath] = useState('');
  const [sfUrl, setSfUrl] = useState('');
  const [sfUser, setSfUser] = useState('');
  const [sfPass, setSfPass] = useState('');
  const [sfToken, setSfToken] = useState('');
  const [configSaved, setConfigSaved] = useState(false);

  useEffect(() => {
    document.title = 'Dogfood — CTO Dashboard';
  }, []);

  // Load evals + history + config on mount
  useEffect(() => {
    if (connected) {
      send('eval:list');
      send('eval:history');
      send('config:get');
    }
  }, [connected, send]);

  // Listen for config:data responses via custom event
  useEffect(() => {
    const handler = (e: Event) => {
      const p = (e as CustomEvent).detail as Record<string, unknown>;
      if (p.extensionPath) setExtPath(p.extensionPath as string);
      if (p.sfLoginUrl) setSfUrl(p.sfLoginUrl as string);
      if (p.sfUsername) setSfUser(p.sfUsername as string);
      if (p.sfPassword && p.sfPassword !== '***') setSfPass(p.sfPassword as string);
      if (p.sfSecurityToken && p.sfSecurityToken !== '***') setSfToken(p.sfSecurityToken as string);
    };
    window.addEventListener('config:data', handler);
    return () => window.removeEventListener('config:data', handler);
  }, []);

  const saveExtConfig = () => {
    send('config:update', {
      extensionPath: extPath,
      sfLoginUrl: sfUrl,
      sfUsername: sfUser,
      ...(sfPass && sfPass !== '***' ? { sfPassword: sfPass } : {}),
      ...(sfToken && sfToken !== '***' ? { sfSecurityToken: sfToken } : {}),
    });
    setConfigSaved(true);
    setTimeout(() => setConfigSaved(false), 2000);
  };

  const runTest = (type: string, analyze: boolean) => {
    send(analyze ? 'dogfood:run_with_analysis' : 'dogfood:run', { testType: type });
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-semibold text-zinc-100">Dogfood Testing</h1>
          <div className="flex bg-zinc-800/50 ring-1 ring-zinc-700/50 rounded-lg p-0.5">
            <button
              onClick={() => setActiveTab('tests')}
              className={`text-xs font-medium px-3.5 py-1.5 rounded-md transition-all duration-200 ${
                activeTab === 'tests' ? 'bg-zinc-700 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-300'
              }`}
            >
              Tests
            </button>
            <button
              onClick={() => setActiveTab('evals')}
              className={`text-xs font-medium px-3.5 py-1.5 rounded-md transition-all duration-200 ${
                activeTab === 'evals' ? 'bg-zinc-700 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-300'
              }`}
            >
              Evals ({evals.length})
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {history.length > 0 && (
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="text-xs text-zinc-400 hover:text-zinc-300 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 transition-colors"
            >
              {showHistory ? 'Hide History' : `History (${history.length})`}
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {activeTab === 'tests' && (
          <>
            {/* Extension Config */}
            <div className="bg-zinc-900 rounded-lg border border-zinc-800">
              <button
                onClick={() => setShowExtConfig(!showExtConfig)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-800/50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-zinc-300">Extension Config</span>
                  {extPath && <span className="text-xs text-zinc-500 font-mono truncate max-w-[300px]">{extPath}</span>}
                </div>
                <span className="text-zinc-500 text-xs">{showExtConfig ? '▲' : '▼'}</span>
              </button>
              {showExtConfig && (
                <div className="px-4 pb-4 border-t border-zinc-800 space-y-3 pt-3">
                  <div>
                    <label className="text-xs text-zinc-500 block mb-1">Extension Path</label>
                    <input
                      value={extPath}
                      onChange={e => setExtPath(e.target.value)}
                      placeholder="/path/to/chrome-extension/dist"
                      className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600 font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-zinc-500 block mb-1">Salesforce Login URL</label>
                    <input
                      value={sfUrl}
                      onChange={e => setSfUrl(e.target.value)}
                      placeholder="https://login.salesforce.com"
                      className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600"
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="text-xs text-zinc-500 block mb-1">Username</label>
                      <input
                        value={sfUser}
                        onChange={e => setSfUser(e.target.value)}
                        placeholder="user@example.com"
                        className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-zinc-500 block mb-1">Password</label>
                      <input
                        type="password"
                        value={sfPass}
                        onChange={e => setSfPass(e.target.value)}
                        placeholder="••••••••"
                        className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-zinc-500 block mb-1">Security Token</label>
                      <input
                        type="password"
                        value={sfToken}
                        onChange={e => setSfToken(e.target.value)}
                        placeholder="••••••••"
                        className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={saveExtConfig}
                      className="text-xs font-medium px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors"
                    >
                      Save
                    </button>
                    {configSaved && <span className="text-xs text-green-400">Saved!</span>}
                  </div>
                </div>
              )}
            </div>

            {/* Test Launcher */}
            <div>
              <h2 className="text-sm font-medium text-zinc-300 mb-3">Run Tests</h2>
              <div className="grid gap-3 md:grid-cols-2">
                {TEST_TYPES.map((test) => (
                    <div key={test.id} className="bg-zinc-900 rounded-xl ring-1 ring-zinc-800 p-4 hover:ring-zinc-700 transition-all duration-200 group">
                      <div className="flex items-start gap-3">
                        <span className="text-2xl group-hover:scale-110 transition-transform duration-200">{test.icon}</span>
                        <div className="flex-1 min-w-0">
                          <h3 className="text-sm font-semibold text-zinc-100">{test.label}</h3>
                          <p className="text-xs text-zinc-500 mt-0.5 leading-relaxed">{test.description}</p>
                        </div>
                      </div>
                      <div className="flex gap-2 mt-3">
                        <button
                          onClick={() => runTest(test.id, false)}
                          disabled={running}
                          className="flex-1 text-xs font-medium px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm hover:shadow-indigo-500/20"
                        >
                          {running && testType === test.id && !withAnalysis ? 'Running...' : 'Run'}
                        </button>
                        <button
                          onClick={() => runTest(test.id, true)}
                          disabled={running}
                          className="flex-1 text-xs font-medium px-3 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm hover:shadow-purple-500/20"
                        >
                          {running && testType === test.id && withAnalysis ? 'Analyzing...' : '+ CTO Analysis'}
                        </button>
                      </div>
                    </div>
                ))}
              </div>
            </div>
          </>
        )}

        {activeTab === 'evals' && (
          <>
            {/* Eval Controls */}
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-zinc-300">Eval Scenarios</h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => send('eval:seed')}
                  className="text-xs text-zinc-400 hover:text-zinc-300 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 transition-colors"
                >
                  Seed Defaults
                </button>
                <button
                  onClick={() => send('eval:generate')}
                  disabled={running}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white transition-colors disabled:opacity-40"
                >
                  {running && testType === 'eval-generation' ? 'Generating...' : 'CTO: Generate Evals'}
                </button>
                <button
                  onClick={() => { setShowImport(!showImport); setShowCreateEval(false); }}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors"
                >
                  Import
                </button>
                <button
                  onClick={() => { setShowCreateEval(!showCreateEval); setShowImport(false); }}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-500 text-white transition-colors"
                >
                  + New Eval
                </button>
              </div>
            </div>

            {showImport && (
              <ImportEvalsForm
                running={running && testType === 'eval-import'}
                onImport={(content) => {
                  send('eval:import', { content });
                }}
              />
            )}

            {showCreateEval && (
              <CreateEvalForm onSubmit={(data) => {
                send('eval:create', data);
                setShowCreateEval(false);
              }} />
            )}

            {importResult && (
              <div className={`rounded-lg p-3 text-sm ${
                importResult.error
                  ? 'bg-red-500/10 border border-red-500/30 text-red-300'
                  : 'bg-green-500/10 border border-green-500/30 text-green-300'
              }`}>
                {importResult.error
                  ? `Import failed: ${importResult.error}`
                  : `Imported ${importResult.created} eval${importResult.created !== 1 ? 's' : ''} successfully`}
                <button
                  onClick={() => useDogfoodStore.getState().reset()}
                  className="ml-3 text-xs text-zinc-400 hover:text-zinc-300 underline"
                >
                  dismiss
                </button>
              </div>
            )}

            {/* Run evals controls */}
            {evals.length > 0 && (
              <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-medium text-zinc-300">Run Eval Suite</h3>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      Run all {evals.length} evals against the live extension with a time limit
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-zinc-500">Time limit:</label>
                      <select
                        value={evalDuration}
                        onChange={e => setEvalDuration(parseInt(e.target.value))}
                        className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-300"
                      >
                        <option value={5}>5 min</option>
                        <option value={10}>10 min</option>
                        <option value={20}>20 min</option>
                        <option value={30}>30 min</option>
                        <option value={60}>60 min</option>
                      </select>
                    </div>
                    <button
                      onClick={() => send('eval:run', { durationMinutes: evalDuration })}
                      disabled={running}
                      className="text-xs font-medium px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors disabled:opacity-40"
                    >
                      {running && testType === 'eval-suite' ? 'Running...' : 'Run All Evals'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Eval list */}
            {evals.length > 0 ? (
              <div className="space-y-2">
                {evals.map(eval_ => (
                  <EvalCard
                    key={eval_.id}
                    eval_={eval_}
                    running={running}
                    onDelete={() => send('eval:delete', { evalId: eval_.id })}
                    onRun={() => send('eval:run', { evalIds: [eval_.id], durationMinutes: 5 })}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <div className="text-3xl mb-3">📝</div>
                <p className="text-sm text-zinc-400 mb-2">No evals defined yet</p>
                <p className="text-xs text-zinc-500">
                  Click &quot;Seed Defaults&quot; to add starter evals, &quot;CTO: Generate Evals&quot; to have the CTO
                  create scenarios, or &quot;+ New Eval&quot; to add your own.
                </p>
              </div>
            )}

            {/* Eval Run History */}
            {evalHistory.length > 0 && (
              <div>
                <h2 className="text-sm font-medium text-zinc-300 mb-3">Eval Run History</h2>
                <div className="bg-zinc-900 rounded-lg border border-zinc-800 overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-zinc-800 text-zinc-500">
                        <th className="text-left px-3 py-2 font-medium">Eval</th>
                        <th className="text-left px-3 py-2 font-medium">Result</th>
                        <th className="text-left px-3 py-2 font-medium">TTFT</th>
                        <th className="text-left px-3 py-2 font-medium">Response</th>
                        <th className="text-left px-3 py-2 font-medium">When</th>
                        <th className="text-left px-3 py-2 font-medium">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {evalHistory.map((run, i) => (
                        <tr key={i} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                          <td className="px-3 py-2 text-zinc-300">{run.evalName || run.evalId.slice(0, 12)}</td>
                          <td className="px-3 py-2">
                            <StatusBadge success={run.passed} />
                          </td>
                          <td className="px-3 py-2 text-zinc-400 font-mono">
                            {run.ttft_ms != null ? `${run.ttft_ms}ms` : '-'}
                          </td>
                          <td className="px-3 py-2 text-zinc-400 font-mono">
                            {run.response_ms != null ? `${(run.response_ms / 1000).toFixed(1)}s` : '-'}
                          </td>
                          <td className="px-3 py-2 text-zinc-500">
                            {formatDateTime(run.run_at)}
                          </td>
                          <td className="px-3 py-2 text-zinc-500 max-w-[200px] truncate">
                            {run.notes.length > 0 ? run.notes.join('; ') : run.responseSnippet?.slice(0, 60) || '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        {/* Live progress panel */}
        {running && <LiveTestPanel testType={testType} withAnalysis={withAnalysis} evalDuration={evalDuration} liveLogs={liveLogs} liveScreenshots={liveScreenshots} currentStep={currentStep} onCancel={() => send('chat:abort')} />}

        {/* Error */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
            <h3 className="text-sm font-medium text-red-400">Test Failed</h3>
            <p className="text-xs text-red-300 mt-1 font-mono">{error}</p>
          </div>
        )}

        {/* Results */}
        {results.length > 0 && (
          <div>
            <h2 className="text-sm font-medium text-zinc-300 mb-3">Latest Results</h2>
            <div className="space-y-2">
              {results.map((result, i) => <ResultCard key={i} result={result} />)}
            </div>
            {report && (
              <details className="mt-3">
                <summary className="text-xs text-zinc-500 cursor-pointer hover:text-zinc-400">View raw report</summary>
                <pre className="mt-2 bg-zinc-950 rounded-lg p-3 text-xs text-zinc-400 overflow-x-auto whitespace-pre-wrap font-mono">
                  {report}
                </pre>
              </details>
            )}
          </div>
        )}

        {/* History */}
        {showHistory && history.length > 0 && (
          <div>
            <h2 className="text-sm font-medium text-zinc-300 mb-3">Test History</h2>
            <div className="space-y-2">
              {history.map((entry, i) => (
                <div key={i} className="bg-zinc-900 rounded-lg border border-zinc-800 p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-zinc-500 font-mono">
                        {formatDateTime(entry.timestamp)}
                      </span>
                      <span className="text-xs text-zinc-400">{entry.testType}</span>
                    </div>
                    <div className="flex gap-1">
                      {entry.results.map((r, j) => <StatusBadge key={j} success={r.success} />)}
                    </div>
                  </div>
                  <div className="mt-1 text-xs text-zinc-500">
                    {entry.results.map(r => `${r.testName}: ${r.duration_ms}ms`).join(' | ')}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {!running && results.length === 0 && !error && activeTab === 'tests' && (
          <div className="flex items-center justify-center py-16">
            <div className="text-center">
              <div className="text-4xl mb-4">🐕</div>
              <h2 className="text-lg font-medium text-zinc-300 mb-2">Dogfood Your Product</h2>
              <p className="text-sm text-zinc-500 max-w-md">
                Run automated tests against your Chrome extension to measure latency,
                catch visual regressions, and verify end-to-end functionality.
                Use &quot;Proactive Exploration&quot; to autonomously test edge cases, or
                switch to the Evals tab to manage configurable test scenarios.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
