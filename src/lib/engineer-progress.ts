export interface EngineerMilestone {
  type: 'file_read' | 'file_edit' | 'bash' | 'git_branch' | 'git_commit' | 'git_push' | 'pr_created' | 'test_run';
  label: string;
  timestamp: number;
}

export interface EngineerProgress {
  milestones: EngineerMilestone[];
  currentActivity: string | null;
}

const patterns: Array<{
  regex: RegExp;
  type: EngineerMilestone['type'];
  label: (match: RegExpMatchArray) => string;
  activity?: string;
}> = [
  { regex: /Read\s+(.+\.\w+)/, type: 'file_read', label: (m) => `Read ${basename(m[1])}`, activity: 'Reading files' },
  { regex: /Edit\s+(.+\.\w+)/, type: 'file_edit', label: (m) => `Edited ${basename(m[1])}`, activity: 'Editing files' },
  { regex: /Write\s+(.+\.\w+)/, type: 'file_edit', label: (m) => `Wrote ${basename(m[1])}`, activity: 'Writing files' },
  { regex: /Bash.*?(npm test|jest|pytest|vitest|cargo test|go test)/, type: 'test_run', label: () => 'Tests', activity: 'Running tests' },
  { regex: /git checkout -b\s+(\S+)/, type: 'git_branch', label: (m) => `Branch: ${m[1]}`, activity: 'Creating branch' },
  { regex: /git commit/, type: 'git_commit', label: () => 'Committed', activity: 'Committing changes' },
  { regex: /git push/, type: 'git_push', label: () => 'Pushed', activity: 'Pushing to remote' },
  { regex: /gh pr create/, type: 'pr_created', label: () => 'PR created', activity: 'Creating PR' },
  { regex: /https:\/\/github\.com\/[^\s]+\/pull\/\d+/, type: 'pr_created', label: () => 'PR created' },
  { regex: /Bash.*?(\S+)/, type: 'bash', label: (m) => `$ ${m[1].slice(0, 20)}`, activity: 'Running command' },
];

function basename(filepath: string): string {
  const parts = filepath.split('/');
  return parts[parts.length - 1] || filepath;
}

/**
 * Parse a new chunk of engineer output for progress milestones.
 * Returns an updated progress object.
 */
export function parseChunkForProgress(
  text: string,
  existing: EngineerProgress,
): EngineerProgress {
  const milestones = [...existing.milestones];
  let currentActivity = existing.currentActivity;

  for (const pattern of patterns) {
    const match = text.match(pattern.regex);
    if (match) {
      // Avoid duplicate milestones of the same type with the same label
      const label = pattern.label(match);
      const isDuplicate = milestones.some(
        (m) => m.type === pattern.type && m.label === label
      );

      if (!isDuplicate) {
        milestones.push({
          type: pattern.type,
          label,
          timestamp: Date.now(),
        });
      }

      if (pattern.activity) {
        currentActivity = pattern.activity;
      }
    }
  }

  // Keep only the last 20 milestones to avoid memory bloat
  const trimmed = milestones.length > 20 ? milestones.slice(-20) : milestones;

  return { milestones: trimmed, currentActivity };
}

export function createEmptyProgress(): EngineerProgress {
  return { milestones: [], currentActivity: null };
}
