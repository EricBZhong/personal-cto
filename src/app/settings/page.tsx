'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useWs } from '@/components/layout/DashboardShell';
import { Spinner } from '@/components/ui/Spinner';

interface ConfigRevision {
  id: string;
  changedFields: string[];
  timestamp: string;
}

interface RepoConfig {
  name: string;
  localPath: string;
  githubSlug: string;
  baseBranch: string;
}

interface SkillProfileConfig {
  name: string;
  description: string;
  systemPromptAddition?: string;
  mcpServers?: string[];
  modelOverride?: string;
}

interface ToolRegistryConfig {
  name: string;
  description: string;
  envVar: string;
  value: string;
  skillProfiles?: string[];
}

interface DeployTargetConfig {
  repoName: string;
  gcpProject: string;
  gcpRegion: string;
  serviceName: string;
  dockerfilePath?: string;
  healthCheckUrl?: string;
}

interface ConfigState {
  colbyRepoPath: string;
  ctoDashboardRepoPath: string;
  repos: RepoConfig[];
  claudeCliPath: string;
  ctoModel: string;
  engineerDefaultModel: string;
  engineerMaxConcurrent: number;
  engineerTokenBudget: number;
  engineerTimeoutMinutes: number;
  checkinIntervalMinutes: number;
  notionApiKey: string;
  notionBoardId: string;
  vantaApiKey: string;
  githubRepo: string;
  githubToken: string;
  twilioAccountSid: string;
  twilioAuthToken: string;
  twilioPhoneNumber: string;
  ceoPhoneNumber: string;
  slackBotToken: string;
  slackAppToken: string;
  slackSigningSecret: string;
  slackUpdateChannel: string;
  browserAutomationEnabled: boolean;
  browserHeadless: boolean;
  skillProfiles: SkillProfileConfig[];
  toolRegistry: ToolRegistryConfig[];
  deployTargets: DeployTargetConfig[];
}

export default function SettingsPage() {
  const { send, connected } = useWs();
  const [config, setConfig] = useState<ConfigState>({
    colbyRepoPath: '',
    ctoDashboardRepoPath: '',
    repos: [],
    claudeCliPath: '',
    ctoModel: 'opus',
    engineerDefaultModel: 'sonnet',
    engineerMaxConcurrent: 10,
    engineerTokenBudget: 500000,
    engineerTimeoutMinutes: 30,
    checkinIntervalMinutes: 120,
    notionApiKey: '',
    notionBoardId: '',
    vantaApiKey: '',
    githubRepo: '',
    githubToken: '',
    twilioAccountSid: '',
    twilioAuthToken: '',
    twilioPhoneNumber: '',
    ceoPhoneNumber: '',
    slackBotToken: '',
    slackAppToken: '',
    slackSigningSecret: '',
    slackUpdateChannel: '',
    browserAutomationEnabled: false,
    browserHeadless: true,
    skillProfiles: [],
    toolRegistry: [],
    deployTargets: [],
  });
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [revisions, setRevisions] = useState<ConfigRevision[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const configReceivedRef = useRef(false);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    document.title = 'Settings -- CTO Dashboard';
  }, []);

  // F9: Retry mechanism for config:get with max 3 retries at 3s intervals
  useEffect(() => {
    if (!connected) return;
    configReceivedRef.current = false;
    retryCountRef.current = 0;

    const attemptFetch = () => {
      send('config:get');
      retryTimerRef.current = setTimeout(() => {
        if (!configReceivedRef.current && retryCountRef.current < 3) {
          retryCountRef.current++;
          console.warn(`[Settings] config:get retry ${retryCountRef.current}/3`);
          attemptFetch();
        } else if (!configReceivedRef.current) {
          setConfigError('Failed to load configuration after 3 retries');
        }
      }, 3000);
    };

    attemptFetch();

    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, [connected, send]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      // F19: typeof guard on CustomEvent detail
      if (typeof detail === 'object' && detail !== null) {
        // F10: Replace config, but merge with defaults to fill any missing fields
        setConfig(prev => {
          const defaults: ConfigState = {
            colbyRepoPath: '', ctoDashboardRepoPath: '', repos: [], claudeCliPath: '',
            ctoModel: 'opus', engineerDefaultModel: 'sonnet', engineerMaxConcurrent: 10,
            engineerTokenBudget: 500000, engineerTimeoutMinutes: 30, checkinIntervalMinutes: 120,
            notionApiKey: '', notionBoardId: '', vantaApiKey: '', githubRepo: '', githubToken: '',
            twilioAccountSid: '', twilioAuthToken: '', twilioPhoneNumber: '', ceoPhoneNumber: '',
            slackBotToken: '', slackAppToken: '', slackSigningSecret: '', slackUpdateChannel: '',
            browserAutomationEnabled: false, browserHeadless: true,
            skillProfiles: [], toolRegistry: [], deployTargets: [],
          };
          return { ...defaults, ...(detail as Partial<ConfigState>) };
        });
        configReceivedRef.current = true;
        setConfigError(null);
        // Clear save timeout if this is a response to a save
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current);
          saveTimeoutRef.current = null;
        }
        // Clear retry timer
        if (retryTimerRef.current) {
          clearTimeout(retryTimerRef.current);
          retryTimerRef.current = null;
        }
      }
    };
    const revisionHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.revisions) setRevisions(detail.revisions);
    };
    // F11: Listen for config:error events
    const errorHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (typeof detail === 'object' && detail !== null && 'error' in detail) {
        setConfigError(String((detail as { error: unknown }).error));
      }
    };
    window.addEventListener('config:data', handler);
    window.addEventListener('config:revisions', revisionHandler);
    window.addEventListener('config:error', errorHandler);
    return () => {
      window.removeEventListener('config:data', handler);
      window.removeEventListener('config:revisions', revisionHandler);
      window.removeEventListener('config:error', errorHandler);
    };
  }, []);

  const handleSave = useCallback(() => {
    setSaving(true);
    setConfigError(null);
    send('config:update', config as unknown as Record<string, unknown>);

    // F11: Save timeout -- if no config:data response within 5s, show error
    saveTimeoutRef.current = setTimeout(() => {
      setConfigError('Save may have failed -- no confirmation received');
      saveTimeoutRef.current = null;
    }, 5000);

    setTimeout(() => {
      setSaving(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }, 500);
  }, [send, config]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto p-6 space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-zinc-100">Settings</h1>
            <p className="text-sm text-zinc-500 mt-1">All settings are saved to disk and persist across restarts.</p>
          </div>
        </div>

        {/* Repositories */}
        <Section title="Repositories" borderColor="border-l-blue-500" icon={<RepoIcon />}>
          <p className="text-xs text-zinc-500 mb-3">Configure repos the CTO can assign tasks to. Each repo needs a name, local path, GitHub slug, and base branch.</p>
          {(config.repos || []).map((repo, idx) => (
            <div key={idx} className="bg-zinc-800/40 ring-1 ring-zinc-800 rounded-xl p-4 mb-3 relative group">
              <button
                onClick={() => {
                  const next = [...config.repos];
                  next.splice(idx, 1);
                  setConfig({ ...config, repos: next });
                }}
                className="absolute top-3 right-3 text-zinc-600 hover:text-red-400 text-xs w-6 h-6 rounded-lg flex items-center justify-center hover:bg-red-500/10 transition-all duration-200 opacity-0 group-hover:opacity-100"
                title="Remove repo"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              <div className="grid grid-cols-2 gap-3">
                <Field
                  label="Name"
                  value={repo.name}
                  onChange={(v) => {
                    const next = [...config.repos];
                    next[idx] = { ...next[idx], name: v };
                    setConfig({ ...config, repos: next });
                  }}
                  placeholder="my-app"
                />
                <Field
                  label="Base Branch"
                  value={repo.baseBranch}
                  onChange={(v) => {
                    const next = [...config.repos];
                    next[idx] = { ...next[idx], baseBranch: v };
                    setConfig({ ...config, repos: next });
                  }}
                  placeholder="main"
                />
                <Field
                  label="Local Path"
                  value={repo.localPath}
                  onChange={(v) => {
                    const next = [...config.repos];
                    next[idx] = { ...next[idx], localPath: v };
                    setConfig({ ...config, repos: next });
                  }}
                  placeholder="/Users/.../repo"
                />
                <Field
                  label="GitHub Slug"
                  value={repo.githubSlug}
                  onChange={(v) => {
                    const next = [...config.repos];
                    next[idx] = { ...next[idx], githubSlug: v };
                    setConfig({ ...config, repos: next });
                  }}
                  placeholder="owner/repo"
                />
              </div>
            </div>
          ))}
          <button
            onClick={() => {
              setConfig({
                ...config,
                repos: [...(config.repos || []), { name: '', localPath: '', githubSlug: '', baseBranch: 'main' }],
              });
            }}
            className="text-xs text-indigo-400 hover:text-indigo-300 font-medium transition-colors duration-200"
          >
            + Add Repo
          </button>
          <div className="mt-4">
            <Field
              label="Claude CLI Path"
              value={config.claudeCliPath}
              onChange={(v) => setConfig({ ...config, claudeCliPath: v })}
              placeholder="claude"
            />
          </div>
        </Section>

        {/* Models */}
        <Section title="Models" borderColor="border-l-purple-500" icon={<ModelIcon />}>
          <SelectField
            label="CTO Model"
            value={config.ctoModel}
            onChange={(v) => setConfig({ ...config, ctoModel: v })}
            options={[
              { value: 'opus', label: 'Opus (most capable, $$$)' },
              { value: 'sonnet', label: 'Sonnet (fast, $$)' },
              { value: 'haiku', label: 'Haiku (cheapest, $)' },
            ]}
          />
          <SelectField
            label="Default Engineer Model"
            value={config.engineerDefaultModel}
            onChange={(v) => setConfig({ ...config, engineerDefaultModel: v })}
            options={[
              { value: 'opus', label: 'Opus' },
              { value: 'sonnet', label: 'Sonnet' },
              { value: 'haiku', label: 'Haiku' },
            ]}
          />
        </Section>

        {/* Resources */}
        <Section title="Resources" borderColor="border-l-amber-500" icon={<ResourceIcon />}>
          <NumberField
            label="Max Concurrent Engineers"
            value={config.engineerMaxConcurrent}
            onChange={(v) => setConfig({ ...config, engineerMaxConcurrent: v })}
            min={1}
            max={50}
          />
          <NumberField
            label="Engineer Token Budget (per task)"
            value={config.engineerTokenBudget}
            onChange={(v) => setConfig({ ...config, engineerTokenBudget: v })}
            min={0}
            max={10000000}
            step={50000}
          />
          <p className="text-xs text-zinc-600 -mt-2">Warning at 80%, kill at 100%. Set 0 for unlimited.</p>
          <NumberField
            label="Engineer Timeout (minutes)"
            value={config.engineerTimeoutMinutes}
            onChange={(v) => setConfig({ ...config, engineerTimeoutMinutes: v })}
            min={1}
            max={120}
          />
        </Section>

        {/* Notion */}
        <Section title="Notion Integration" borderColor="border-l-emerald-500" icon={<IntegrationIcon />}>
          <p className="text-xs text-zinc-500 mb-2">Connect to your Notion engineering board to sync tickets.</p>
          <Field
            label="Notion API Key"
            value={config.notionApiKey}
            onChange={(v) => setConfig({ ...config, notionApiKey: v })}
            placeholder="secret_..."
            type="password"
          />
          <Field
            label="Notion Engineering Board ID"
            value={config.notionBoardId}
            onChange={(v) => setConfig({ ...config, notionBoardId: v })}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          />
        </Section>

        {/* Vanta */}
        <Section title="Vanta (SOC 2 Compliance)" borderColor="border-l-cyan-500" icon={<ShieldIcon />}>
          <p className="text-xs text-zinc-500 mb-2">Connect to Vanta to track SOC 2 compliance status and auto-remediate failing controls.</p>
          <Field
            label="Vanta API Key"
            value={config.vantaApiKey}
            onChange={(v) => setConfig({ ...config, vantaApiKey: v })}
            placeholder="va_..."
            type="password"
          />
        </Section>

        {/* GitHub */}
        <Section title="GitHub" borderColor="border-l-zinc-500" icon={<GithubIcon />}>
          <p className="text-xs text-zinc-500 mb-2">
            Engineers need a GitHub token to create PRs, view diffs, and interact with repos.
            Generate one at github.com/settings/tokens with repo scope.
          </p>
          <Field
            label="GitHub Repo (owner/name)"
            value={config.githubRepo}
            onChange={(v) => setConfig({ ...config, githubRepo: v })}
            placeholder="owner/repo"
          />
          <Field
            label="GitHub Token (GH_TOKEN)"
            value={config.githubToken}
            onChange={(v) => setConfig({ ...config, githubToken: v })}
            placeholder="ghp_..."
            type="password"
          />
        </Section>

        {/* Twilio */}
        <Section title="Twilio (Call/Text the CTO)" borderColor="border-l-red-500" icon={<PhoneIcon />}>
          <p className="text-xs text-zinc-500 mb-2">
            Set up Twilio to call or text a phone number and interact with the CTO via voice or SMS.
            Configure Twilio webhooks to point to this server&apos;s port 3102.
          </p>
          <Field
            label="Twilio Account SID"
            value={config.twilioAccountSid}
            onChange={(v) => setConfig({ ...config, twilioAccountSid: v })}
            placeholder="AC..."
          />
          <Field
            label="Twilio Auth Token"
            value={config.twilioAuthToken}
            onChange={(v) => setConfig({ ...config, twilioAuthToken: v })}
            placeholder="..."
            type="password"
          />
          <Field
            label="Twilio Phone Number"
            value={config.twilioPhoneNumber}
            onChange={(v) => setConfig({ ...config, twilioPhoneNumber: v })}
            placeholder="+1..."
          />
          <Field
            label="Your Phone Number (CEO)"
            value={config.ceoPhoneNumber}
            onChange={(v) => setConfig({ ...config, ceoPhoneNumber: v })}
            placeholder="+1..."
          />
        </Section>

        {/* Slack */}
        <Section title="Slack Integration" borderColor="border-l-indigo-500" icon={<SlackIcon />}>
          <p className="text-xs text-zinc-500 mb-2">
            Connect to Slack so the CTO can post updates, respond to DMs, and reply when @mentioned.
            Uses Socket Mode (no public URL needed).
          </p>
          <div className="bg-zinc-800/40 ring-1 ring-zinc-800 rounded-lg p-3 mb-4">
            <p className="text-xs text-zinc-400 leading-relaxed">
              <strong className="text-zinc-300">Setup:</strong>{' '}
              Create a Slack App at api.slack.com/apps &rarr; Enable Socket Mode &rarr; Generate an App-Level Token
              (connections:write) &rarr; Add Bot Token Scopes (chat:write, channels:read, im:read, im:write,
              app_mentions:read, users:read) &rarr; Subscribe to Events (message.im, message.groups, app_mention)
              &rarr; Install to workspace.
            </p>
          </div>
          <Field
            label="Bot Token (xoxb-...)"
            value={config.slackBotToken}
            onChange={(v) => setConfig({ ...config, slackBotToken: v })}
            placeholder="xoxb-..."
            type="password"
          />
          <Field
            label="App-Level Token (xapp-...)"
            value={config.slackAppToken}
            onChange={(v) => setConfig({ ...config, slackAppToken: v })}
            placeholder="xapp-..."
            type="password"
          />
          <Field
            label="Signing Secret"
            value={config.slackSigningSecret}
            onChange={(v) => setConfig({ ...config, slackSigningSecret: v })}
            placeholder="..."
            type="password"
          />
          <Field
            label="Updates Channel (for periodic CTO updates)"
            value={config.slackUpdateChannel}
            onChange={(v) => setConfig({ ...config, slackUpdateChannel: v })}
            placeholder="#engineering-updates or C0123456789"
          />
        </Section>

        {/* Browser Automation */}
        <Section title="Browser Automation" borderColor="border-l-orange-500" icon={<BrowserIcon />}>
          <p className="text-xs text-zinc-500 mb-2">
            Enable Playwright MCP server for engineers to interact with web UIs (Vanta, Salesforce, etc.).
            Requires @anthropic-ai/mcp-server-playwright.
          </p>
          <ToggleField
            label="Enable Browser Automation"
            value={config.browserAutomationEnabled}
            onChange={(v) => setConfig({ ...config, browserAutomationEnabled: v })}
          />
          <ToggleField
            label="Headless Mode"
            value={config.browserHeadless}
            onChange={(v) => setConfig({ ...config, browserHeadless: v })}
            description="Run browser without visible window"
          />
        </Section>

        {/* Check-in Interval */}
        <Section title="Periodic Check-in" borderColor="border-l-green-500" icon={<ClockIcon />}>
          <p className="text-xs text-zinc-500 mb-2">How often the CTO runs automatic status check-ins and project advancement.</p>
          <NumberField
            label="Check-in Interval (minutes)"
            value={config.checkinIntervalMinutes}
            onChange={(v) => setConfig({ ...config, checkinIntervalMinutes: v })}
            min={15}
            max={1440}
            step={15}
          />
        </Section>

        {/* Skill Profiles */}
        <Section title="Skill Profiles" borderColor="border-l-violet-500" icon={<SkillIcon />}>
          <p className="text-xs text-zinc-500 mb-3">
            Define engineer specializations. Each profile can add custom prompt instructions, model overrides, and MCP servers.
          </p>
          {(config.skillProfiles || []).map((profile, idx) => (
            <div key={idx} className="bg-zinc-800/40 ring-1 ring-zinc-800 rounded-xl p-4 mb-3 relative group">
              <button
                onClick={() => {
                  const next = [...config.skillProfiles];
                  next.splice(idx, 1);
                  setConfig({ ...config, skillProfiles: next });
                }}
                className="absolute top-3 right-3 text-zinc-600 hover:text-red-400 text-xs w-6 h-6 rounded-lg flex items-center justify-center hover:bg-red-500/10 transition-all duration-200 opacity-0 group-hover:opacity-100"
                title="Remove profile"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <Field
                  label="Name"
                  value={profile.name}
                  onChange={(v) => {
                    const next = [...config.skillProfiles];
                    next[idx] = { ...next[idx], name: v };
                    setConfig({ ...config, skillProfiles: next });
                  }}
                  placeholder="frontend"
                />
                <Field
                  label="Model Override"
                  value={profile.modelOverride || ''}
                  onChange={(v) => {
                    const next = [...config.skillProfiles];
                    next[idx] = { ...next[idx], modelOverride: v || undefined };
                    setConfig({ ...config, skillProfiles: next });
                  }}
                  placeholder="(use default)"
                />
              </div>
              <Field
                label="Description"
                value={profile.description}
                onChange={(v) => {
                  const next = [...config.skillProfiles];
                  next[idx] = { ...next[idx], description: v };
                  setConfig({ ...config, skillProfiles: next });
                }}
                placeholder="Specializes in React, CSS, and frontend architecture"
              />
              <div className="mt-3">
                <TextAreaField
                  label="System Prompt Addition"
                  value={profile.systemPromptAddition || ''}
                  onChange={(v) => {
                    const next = [...config.skillProfiles];
                    next[idx] = { ...next[idx], systemPromptAddition: v || undefined };
                    setConfig({ ...config, skillProfiles: next });
                  }}
                  placeholder="Additional instructions for this engineer specialization..."
                />
              </div>
            </div>
          ))}
          <button
            onClick={() => {
              setConfig({
                ...config,
                skillProfiles: [...(config.skillProfiles || []), { name: '', description: '' }],
              });
            }}
            className="text-xs text-indigo-400 hover:text-indigo-300 font-medium transition-colors duration-200"
          >
            + Add Skill Profile
          </button>
        </Section>

        {/* API Tool Registry */}
        <Section title="API Tool Registry" borderColor="border-l-pink-500" icon={<ToolIcon />}>
          <p className="text-xs text-zinc-500 mb-3">
            Register API keys that engineers can use. Associate them with skill profiles for automatic injection.
          </p>
          {(config.toolRegistry || []).map((tool, idx) => (
            <div key={idx} className="bg-zinc-800/40 ring-1 ring-zinc-800 rounded-xl p-4 mb-3 relative group">
              <button
                onClick={() => {
                  const next = [...config.toolRegistry];
                  next.splice(idx, 1);
                  setConfig({ ...config, toolRegistry: next });
                }}
                className="absolute top-3 right-3 text-zinc-600 hover:text-red-400 text-xs w-6 h-6 rounded-lg flex items-center justify-center hover:bg-red-500/10 transition-all duration-200 opacity-0 group-hover:opacity-100"
                title="Remove tool"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              <div className="grid grid-cols-2 gap-3">
                <Field
                  label="Name"
                  value={tool.name}
                  onChange={(v) => {
                    const next = [...config.toolRegistry];
                    next[idx] = { ...next[idx], name: v };
                    setConfig({ ...config, toolRegistry: next });
                  }}
                  placeholder="ElevenLabs TTS"
                />
                <Field
                  label="Environment Variable"
                  value={tool.envVar}
                  onChange={(v) => {
                    const next = [...config.toolRegistry];
                    next[idx] = { ...next[idx], envVar: v };
                    setConfig({ ...config, toolRegistry: next });
                  }}
                  placeholder="ELEVENLABS_API_KEY"
                />
                <Field
                  label="Value (Secret)"
                  value={tool.value}
                  onChange={(v) => {
                    const next = [...config.toolRegistry];
                    next[idx] = { ...next[idx], value: v };
                    setConfig({ ...config, toolRegistry: next });
                  }}
                  placeholder="sk-..."
                  type="password"
                />
                <Field
                  label="Skill Profiles (comma-separated)"
                  value={(tool.skillProfiles || []).join(', ')}
                  onChange={(v) => {
                    const next = [...config.toolRegistry];
                    next[idx] = { ...next[idx], skillProfiles: v.split(',').map(s => s.trim()).filter(Boolean) };
                    setConfig({ ...config, toolRegistry: next });
                  }}
                  placeholder="frontend, media"
                />
              </div>
              <div className="mt-3">
                <Field
                  label="Description"
                  value={tool.description}
                  onChange={(v) => {
                    const next = [...config.toolRegistry];
                    next[idx] = { ...next[idx], description: v };
                    setConfig({ ...config, toolRegistry: next });
                  }}
                  placeholder="Text-to-speech API for generating voiceovers"
                />
              </div>
            </div>
          ))}
          <button
            onClick={() => {
              setConfig({
                ...config,
                toolRegistry: [...(config.toolRegistry || []), { name: '', description: '', envVar: '', value: '' }],
              });
            }}
            className="text-xs text-indigo-400 hover:text-indigo-300 font-medium transition-colors duration-200"
          >
            + Add API Tool
          </button>
        </Section>

        {/* Deploy Targets */}
        <Section title="Deploy Targets" borderColor="border-l-teal-500" icon={<DeployIcon />}>
          <p className="text-xs text-zinc-500 mb-3">
            Configure Cloud Run deployment targets for auto-deploy. Each target maps a repo to a GCP service.
          </p>
          {(config.deployTargets || []).map((target, idx) => (
            <div key={idx} className="bg-zinc-800/40 ring-1 ring-zinc-800 rounded-xl p-4 mb-3 relative group">
              <button
                onClick={() => {
                  const next = [...config.deployTargets];
                  next.splice(idx, 1);
                  setConfig({ ...config, deployTargets: next });
                }}
                className="absolute top-3 right-3 text-zinc-600 hover:text-red-400 text-xs w-6 h-6 rounded-lg flex items-center justify-center hover:bg-red-500/10 transition-all duration-200 opacity-0 group-hover:opacity-100"
                title="Remove target"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              <div className="grid grid-cols-2 gap-3">
                <Field
                  label="Repo Name"
                  value={target.repoName}
                  onChange={(v) => {
                    const next = [...config.deployTargets];
                    next[idx] = { ...next[idx], repoName: v };
                    setConfig({ ...config, deployTargets: next });
                  }}
                  placeholder="my-app"
                />
                <Field
                  label="Service Name"
                  value={target.serviceName}
                  onChange={(v) => {
                    const next = [...config.deployTargets];
                    next[idx] = { ...next[idx], serviceName: v };
                    setConfig({ ...config, deployTargets: next });
                  }}
                  placeholder="my-api"
                />
                <Field
                  label="GCP Project"
                  value={target.gcpProject}
                  onChange={(v) => {
                    const next = [...config.deployTargets];
                    next[idx] = { ...next[idx], gcpProject: v };
                    setConfig({ ...config, deployTargets: next });
                  }}
                  placeholder="my-project-prod"
                />
                <Field
                  label="GCP Region"
                  value={target.gcpRegion}
                  onChange={(v) => {
                    const next = [...config.deployTargets];
                    next[idx] = { ...next[idx], gcpRegion: v };
                    setConfig({ ...config, deployTargets: next });
                  }}
                  placeholder="us-central1"
                />
                <Field
                  label="Dockerfile Path"
                  value={target.dockerfilePath || ''}
                  onChange={(v) => {
                    const next = [...config.deployTargets];
                    next[idx] = { ...next[idx], dockerfilePath: v || undefined };
                    setConfig({ ...config, deployTargets: next });
                  }}
                  placeholder="Dockerfile (default)"
                />
                <Field
                  label="Health Check URL"
                  value={target.healthCheckUrl || ''}
                  onChange={(v) => {
                    const next = [...config.deployTargets];
                    next[idx] = { ...next[idx], healthCheckUrl: v || undefined };
                    setConfig({ ...config, deployTargets: next });
                  }}
                  placeholder="https://service-url/health"
                />
              </div>
            </div>
          ))}
          <button
            onClick={() => {
              setConfig({
                ...config,
                deployTargets: [...(config.deployTargets || []), { repoName: '', gcpProject: '', gcpRegion: 'us-central1', serviceName: '' }],
              });
            }}
            className="text-xs text-indigo-400 hover:text-indigo-300 font-medium transition-colors duration-200"
          >
            + Add Deploy Target
          </button>
        </Section>

        {/* Config History */}
        <Section title="Config History" borderColor="border-l-zinc-600" icon={<HistoryIcon />}>
          <button
            onClick={() => {
              if (!showHistory) send('config:revisions');
              setShowHistory(!showHistory);
            }}
            className="text-xs text-indigo-400 hover:text-indigo-300 font-medium transition-colors duration-200"
          >
            {showHistory ? 'Hide history' : 'Show revision history'}
          </button>
          {showHistory && (
            <div className="mt-3 space-y-2">
              {revisions.length === 0 && (
                <p className="text-xs text-zinc-600">No revisions yet. Changes are tracked after your first save.</p>
              )}
              {revisions.map((rev) => (
                <div key={rev.id} className="flex items-center justify-between bg-zinc-800/40 ring-1 ring-zinc-800 rounded-lg p-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-zinc-400">
                      {new Date(rev.timestamp).toLocaleString()}
                    </div>
                    <div className="text-[10px] text-zinc-500 truncate mt-0.5">
                      Changed: {rev.changedFields.join(', ')}
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      if (confirm('Roll back to this revision? This will overwrite current settings.')) {
                        send('config:rollback', { revisionId: rev.id });
                      }
                    }}
                    className="text-xs text-amber-400 hover:text-amber-300 px-3 py-1.5 rounded-lg bg-amber-500/10 ring-1 ring-amber-500/20 hover:bg-amber-500/20 transition-all duration-200 flex-shrink-0 ml-3"
                  >
                    Rollback
                  </button>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Save */}
        <div className="flex items-center gap-3 pb-8">
          <button
            onClick={handleSave}
            disabled={!connected || saving}
            className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-lg shadow-indigo-500/10 hover:shadow-indigo-500/20"
          >
            {saving && <Spinner size="sm" />}
            {saving ? 'Saving...' : 'Save All Settings'}
          </button>
          {saved && !configError && (
            <span className="text-sm text-green-400 flex items-center gap-1.5">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Saved!
            </span>
          )}
          {configError && (
            <span className="text-sm text-red-400 flex items-center gap-1.5">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {configError}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============ Section Component ============ */

function Section({ title, borderColor, icon, children }: { title: string; borderColor: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className={`border-l-2 ${borderColor} pl-5`}>
      <div className="flex items-center gap-2 mb-4">
        {icon && <span className="text-zinc-500">{icon}</span>}
        <h2 className="text-sm font-semibold text-zinc-200">{title}</h2>
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

/* ============ Form Fields ============ */

function Field({
  label, value, onChange, placeholder, type = 'text',
}: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs text-zinc-400 mb-1.5 block font-medium">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-zinc-900 ring-1 ring-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 hover:ring-zinc-700 transition-all duration-200"
      />
    </label>
  );
}

function SelectField({
  label, value, onChange, options,
}: {
  label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[];
}) {
  return (
    <label className="block">
      <span className="text-xs text-zinc-400 mb-1.5 block font-medium">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-zinc-900 ring-1 ring-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 hover:ring-zinc-700 transition-all duration-200 cursor-pointer"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </label>
  );
}

function NumberField({
  label, value, onChange, min, max, step = 1,
}: {
  label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number;
}) {
  return (
    <label className="block">
      <span className="text-xs text-zinc-400 mb-1.5 block font-medium">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        min={min}
        max={max}
        step={step}
        className="w-full bg-zinc-900 ring-1 ring-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 hover:ring-zinc-700 transition-all duration-200"
      />
    </label>
  );
}

function TextAreaField({
  label, value, onChange, placeholder,
}: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs text-zinc-400 mb-1.5 block font-medium">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className="w-full bg-zinc-900 ring-1 ring-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 hover:ring-zinc-700 transition-all duration-200 resize-y"
      />
    </label>
  );
}

function ToggleField({
  label, value, onChange, description,
}: {
  label: string; value: boolean; onChange: (v: boolean) => void; description?: string;
}) {
  return (
    <label className="flex items-center justify-between py-1.5 cursor-pointer group">
      <div>
        <span className="text-xs text-zinc-300 font-medium group-hover:text-zinc-200 transition-colors">{label}</span>
        {description && <p className="text-xs text-zinc-600 mt-0.5">{description}</p>}
      </div>
      <button
        onClick={() => onChange(!value)}
        className={`relative w-10 h-5 rounded-full transition-all duration-200 ${value ? 'bg-indigo-600' : 'bg-zinc-700'}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform duration-200 ${value ? 'translate-x-5' : ''}`} />
      </button>
    </label>
  );
}

/* ============ Section Icons ============ */

function RepoIcon() {
  return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>;
}
function ModelIcon() {
  return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>;
}
function ResourceIcon() {
  return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>;
}
function IntegrationIcon() {
  return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>;
}
function ShieldIcon() {
  return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>;
}
function GithubIcon() {
  return <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" /></svg>;
}
function PhoneIcon() {
  return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>;
}
function SlackIcon() {
  return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>;
}
function BrowserIcon() {
  return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" /></svg>;
}
function ClockIcon() {
  return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
}
function SkillIcon() {
  return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>;
}
function ToolIcon() {
  return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>;
}
function DeployIcon() {
  return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>;
}
function HistoryIcon() {
  return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
}
