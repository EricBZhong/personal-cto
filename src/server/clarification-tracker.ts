import { v4 as uuidv4 } from 'uuid';
import { collections } from './firestore';

export interface ClarificationRequest {
  id: string;
  notion_page_id: string;
  ticket_title: string;
  questions: string[];
  ask_user_name: string;
  slack_user_id?: string;
  slack_channel_id?: string;
  slack_message_ts?: string;
  status: 'pending' | 'sent' | 'answered' | 'failed';
  answers?: string;
  context?: string;
  created_at: string;
  answered_at?: string;
}

export interface StrategyPoll {
  id: string;
  ticket_title: string;
  options: Array<{ label: string; description: string }>;
  ask_channel: string;
  slack_message_ts?: string;
  slack_channel_id?: string;
  status: 'pending' | 'posted' | 'decided' | 'failed';
  chosen_option?: string;
  decision_context?: string;
  context?: string;
  created_at: string;
  decided_at?: string;
}

export class ClarificationTracker {
  // In-memory index: channelId -> requestId for fast DM routing
  private channelIndex: Map<string, string> = new Map();

  constructor() {
    this.hydrateIndex();
  }

  private async hydrateIndex(): Promise<void> {
    try {
      const snap = await collections.clarificationRequests
        .where('status', 'in', ['pending', 'sent'])
        .get();
      for (const doc of snap.docs) {
        const data = doc.data();
        if (data.slack_channel_id) {
          this.channelIndex.set(data.slack_channel_id, doc.id);
        }
      }
    } catch {
      // DB may not be initialized yet — will hydrate on first use
    }
  }

  async createRequest(params: {
    notionPageId: string;
    ticketTitle: string;
    questions: string[];
    askUserName: string;
    context?: string;
  }): Promise<ClarificationRequest> {
    const id = uuidv4();
    const now = new Date().toISOString();
    const data = {
      notion_page_id: params.notionPageId,
      ticket_title: params.ticketTitle,
      questions: params.questions,
      ask_user_name: params.askUserName,
      context: params.context || null,
      status: 'pending',
      created_at: now,
    };

    await collections.clarificationRequests.doc(id).set(data);

    return {
      id,
      ...data,
      status: 'pending' as const,
      questions: params.questions,
    } as ClarificationRequest;
  }

  async getRequest(id: string): Promise<ClarificationRequest | null> {
    const doc = await collections.clarificationRequests.doc(id).get();
    if (!doc.exists) return null;
    const data = doc.data()!;
    return {
      id: doc.id,
      ...data,
      questions: data.questions || [],
    } as ClarificationRequest;
  }

  async markSent(id: string, slackUserId: string, slackChannelId: string, slackMessageTs: string): Promise<void> {
    await collections.clarificationRequests.doc(id).update({
      status: 'sent',
      slack_user_id: slackUserId,
      slack_channel_id: slackChannelId,
      slack_message_ts: slackMessageTs,
    });
    this.channelIndex.set(slackChannelId, id);
  }

  async recordAnswer(id: string, answers: string): Promise<void> {
    await collections.clarificationRequests.doc(id).update({
      status: 'answered',
      answers,
      answered_at: new Date().toISOString(),
    });

    const req = await this.getRequest(id);
    if (req?.slack_channel_id) {
      this.channelIndex.delete(req.slack_channel_id);
    }
  }

  async markFailed(id: string): Promise<void> {
    await collections.clarificationRequests.doc(id).update({ status: 'failed' });

    const req = await this.getRequest(id);
    if (req?.slack_channel_id) {
      this.channelIndex.delete(req.slack_channel_id);
    }
  }

  /** Check if there's a pending clarification for this DM channel */
  isPendingResponse(channelId: string): string | null {
    return this.channelIndex.get(channelId) || null;
  }

  getPending(): ClarificationRequest[] {
    // Sync version returns empty — use getPendingAsync for real data
    return [];
  }

  async getPendingAsync(): Promise<ClarificationRequest[]> {
    try {
      const snap = await collections.clarificationRequests
        .where('status', 'in', ['pending', 'sent'])
        .orderBy('created_at', 'desc')
        .get();
      return snap.docs.map(doc => {
        const data = doc.data() || {};
        return { id: doc.id, ...data, questions: data.questions || [] } as ClarificationRequest;
      });
    } catch (err) {
      // Fallback if composite index doesn't exist
      console.warn('[Clarification] Index error, using fallback:', (err as Error).message?.slice(0, 100));
      const snap = await collections.clarificationRequests
        .where('status', 'in', ['pending', 'sent'])
        .get();
      return snap.docs.map(doc => {
        const data = doc.data() || {};
        return { id: doc.id, ...data, questions: data.questions || [] } as ClarificationRequest;
      });
    }
  }
}

export class StrategyPollTracker {
  // In-memory index: channelId:threadTs -> pollId for fast thread reply routing
  private threadIndex: Map<string, string> = new Map();

  constructor() {
    this.hydrateIndex();
  }

  private async hydrateIndex(): Promise<void> {
    try {
      const snap = await collections.strategyPolls
        .where('status', 'in', ['pending', 'posted'])
        .get();
      for (const doc of snap.docs) {
        const data = doc.data();
        if (data.slack_channel_id && data.slack_message_ts) {
          this.threadIndex.set(`${data.slack_channel_id}:${data.slack_message_ts}`, doc.id);
        }
      }
    } catch {
      // DB may not be initialized yet
    }
  }

  async createPoll(params: {
    ticketTitle: string;
    options: Array<{ label: string; description: string }>;
    askChannel: string;
    context?: string;
  }): Promise<StrategyPoll> {
    const id = uuidv4();
    const now = new Date().toISOString();
    const data = {
      ticket_title: params.ticketTitle,
      options: params.options,
      ask_channel: params.askChannel,
      context: params.context || null,
      status: 'pending',
      created_at: now,
    };

    await collections.strategyPolls.doc(id).set(data);

    return {
      id,
      ...data,
      status: 'pending' as const,
      options: params.options,
    } as StrategyPoll;
  }

  async getPoll(id: string): Promise<StrategyPoll | null> {
    const doc = await collections.strategyPolls.doc(id).get();
    if (!doc.exists) return null;
    const data = doc.data()!;
    return {
      id: doc.id,
      ...data,
      options: data.options || [],
    } as StrategyPoll;
  }

  async markPosted(id: string, slackChannelId: string, slackMessageTs: string): Promise<void> {
    await collections.strategyPolls.doc(id).update({
      status: 'posted',
      slack_channel_id: slackChannelId,
      slack_message_ts: slackMessageTs,
    });
    this.threadIndex.set(`${slackChannelId}:${slackMessageTs}`, id);
  }

  async recordDecision(id: string, chosenOption: string, decisionContext?: string): Promise<void> {
    await collections.strategyPolls.doc(id).update({
      status: 'decided',
      chosen_option: chosenOption,
      decision_context: decisionContext || null,
      decided_at: new Date().toISOString(),
    });

    const poll = await this.getPoll(id);
    if (poll?.slack_channel_id && poll?.slack_message_ts) {
      this.threadIndex.delete(`${poll.slack_channel_id}:${poll.slack_message_ts}`);
    }
  }

  async markFailed(id: string): Promise<void> {
    await collections.strategyPolls.doc(id).update({ status: 'failed' });
  }

  /** Check if there's a pending poll for this thread */
  isPendingPoll(channelId: string, threadTs: string): string | null {
    return this.threadIndex.get(`${channelId}:${threadTs}`) || null;
  }

  getPending(): StrategyPoll[] {
    // Sync version returns empty — use getPendingAsync for real data
    return [];
  }

  async getPendingAsync(): Promise<StrategyPoll[]> {
    try {
      const snap = await collections.strategyPolls
        .where('status', 'in', ['pending', 'posted'])
        .orderBy('created_at', 'desc')
        .get();
      return snap.docs.map(doc => {
        const data = doc.data() || {};
        return { id: doc.id, ...data, options: data.options || [] } as StrategyPoll;
      });
    } catch (err) {
      // Fallback if composite index doesn't exist
      console.warn('[StrategyPoll] Index error, using fallback:', (err as Error).message?.slice(0, 100));
      const snap = await collections.strategyPolls
        .where('status', 'in', ['pending', 'posted'])
        .get();
      return snap.docs.map(doc => {
        const data = doc.data() || {};
        return { id: doc.id, ...data, options: data.options || [] } as StrategyPoll;
      });
    }
  }
}

export const clarificationTracker = new ClarificationTracker();
export const strategyPollTracker = new StrategyPollTracker();
