import { v4 as uuidv4 } from 'uuid';
import { collections, toISOString } from './firestore';
import { eventBus } from './event-bus';
import type { MemoryEntry } from '../types';

function docToEntry(id: string, data: FirebaseFirestore.DocumentData): MemoryEntry {
  return {
    id,
    type: data.type || 'learning',
    content: data.content || '',
    projectId: data.projectId || undefined,
    tags: Array.isArray(data.tags) ? data.tags : [],
    created_at: toISOString(data.created_at),
  };
}

export class MemoryStore {
  private _cache: Map<string, MemoryEntry> = new Map();

  async addEntry(params: {
    type: MemoryEntry['type'];
    content: string;
    projectId?: string;
    tags?: string[];
  }): Promise<MemoryEntry> {
    const id = uuidv4();
    const now = new Date().toISOString();
    const entryData = {
      type: params.type,
      content: params.content,
      projectId: params.projectId || null,
      tags: params.tags || [],
      created_at: now,
    };

    const entry = docToEntry(id, entryData);
    this._cache.set(id, entry);

    try {
      await collections.memory.doc(id).set(entryData);
    } catch (err) {
      console.error('[MemoryStore] Failed to write entry:', err);
    }

    eventBus.emitDashboard({ type: 'memory:added', data: { entry } });
    console.log(`[MemoryStore] Added ${params.type} memory: "${params.content.slice(0, 80)}"`);
    return entry;
  }

  async deleteEntry(id: string): Promise<void> {
    this._cache.delete(id);
    try {
      await collections.memory.doc(id).delete();
    } catch (err) {
      console.error('[MemoryStore] Failed to delete entry:', err);
    }
    eventBus.emitDashboard({ type: 'memory:deleted', data: { id } });
  }

  getEntries(filter?: { projectId?: string; type?: string }): MemoryEntry[] {
    let entries = Array.from(this._cache.values());
    if (filter?.projectId) {
      entries = entries.filter(e => e.projectId === filter.projectId || !e.projectId);
    }
    if (filter?.type) {
      entries = entries.filter(e => e.type === filter.type);
    }
    return entries.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }

  async getAllAsync(): Promise<MemoryEntry[]> {
    const snap = await collections.memory.orderBy('created_at', 'desc').get();
    const entries = snap.docs.map(doc => docToEntry(doc.id, doc.data()));
    for (const e of entries) this._cache.set(e.id, e);
    return entries;
  }

  /** Search memories by keyword */
  search(query: string): MemoryEntry[] {
    const lower = query.toLowerCase();
    return Array.from(this._cache.values())
      .filter(e =>
        e.content.toLowerCase().includes(lower) ||
        e.tags.some(t => t.toLowerCase().includes(lower))
      )
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }

  /** Get relevant memories for CTO prompt injection */
  getRelevantMemories(projectId?: string, maxChars: number = 3000): string | undefined {
    const entries = Array.from(this._cache.values());
    if (entries.length === 0) return undefined;

    // Global entries always included; project-scoped only for matching project
    const relevant = entries.filter(e => {
      if (!e.projectId) return true; // Global
      return projectId && e.projectId === projectId;
    });

    if (relevant.length === 0) return undefined;

    // Format and truncate to maxChars
    let result = '';
    for (const entry of relevant.slice(0, 50)) {
      const line = `- [${entry.type}] ${entry.content}${entry.tags.length > 0 ? ` (tags: ${entry.tags.join(', ')})` : ''}\n`;
      if (result.length + line.length > maxChars) break;
      result += line;
    }

    return result.trim() || undefined;
  }

  /** Hydrate cache from Firestore */
  async hydrate(): Promise<void> {
    try {
      const entries = await this.getAllAsync();
      console.log(`[MemoryStore] Hydrated ${entries.length} memories`);
    } catch (err) {
      console.error('[MemoryStore] Failed to hydrate:', err);
    }
  }
}

export const memoryStore = new MemoryStore();
