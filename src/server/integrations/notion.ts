import { getConfig } from '../config';

interface NotionPage {
  id: string;
  title: string;
  status?: string;
  priority?: string;
  assignee?: string;
  url: string;
  lastEdited: string;
}

interface NotionQueryResult {
  results: Array<{
    id: string;
    url: string;
    last_edited_time: string;
    properties: Record<string, NotionProperty>;
  }>;
  has_more: boolean;
  next_cursor: string | null;
}

interface NotionProperty {
  type: string;
  title?: Array<{ plain_text: string }>;
  select?: { name: string } | null;
  people?: Array<{ name: string }>;
  rich_text?: Array<{ plain_text: string }>;
  status?: { name: string } | null;
}

interface NotionUser {
  id: string;
  name: string;
  avatar_url?: string;
  type: string;
  person?: { email?: string };
}

interface NotionBlock {
  type: string;
  paragraph?: { rich_text: Array<{ plain_text: string }> };
  heading_1?: { rich_text: Array<{ plain_text: string }> };
  heading_2?: { rich_text: Array<{ plain_text: string }> };
  heading_3?: { rich_text: Array<{ plain_text: string }> };
  bulleted_list_item?: { rich_text: Array<{ plain_text: string }> };
  numbered_list_item?: { rich_text: Array<{ plain_text: string }> };
  to_do?: { rich_text: Array<{ plain_text: string }>; checked: boolean };
  code?: { rich_text: Array<{ plain_text: string }>; language: string };
  callout?: { rich_text: Array<{ plain_text: string }> };
  divider?: Record<string, never>;
  toggle?: { rich_text: Array<{ plain_text: string }> };
}

export class NotionClient {
  private notionUserCache: Map<string, NotionUser> = new Map();

  private get apiKey(): string | undefined {
    return getConfig().notionApiKey;
  }

  private get boardId(): string | undefined {
    return getConfig().notionBoardId;
  }

  get isConfigured(): boolean {
    return !!(this.apiKey && this.boardId);
  }

  private async request(path: string, options: RequestInit = {}): Promise<unknown> {
    if (!this.apiKey) throw new Error('Notion API key not configured');

    const res = await fetch(`https://api.notion.com/v1${path}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Notion API error ${res.status}: ${body}`);
    }

    return res.json();
  }

  /** Query the engineering board for tickets */
  async queryBoard(filter?: { status?: string; priority?: string; type?: string }): Promise<NotionPage[]> {
    if (!this.boardId) throw new Error('Notion board ID not configured');

    const filterObj: Record<string, unknown> = {};
    const conditions: unknown[] = [];

    if (filter?.status) {
      conditions.push({
        property: 'Status',
        status: { equals: filter.status },
      });
    }
    if (filter?.priority) {
      conditions.push({
        property: 'Priority',
        select: { equals: filter.priority },
      });
    }
    if (filter?.type) {
      conditions.push({
        property: 'Type',
        select: { equals: filter.type },
      });
    }

    if (conditions.length > 1) {
      filterObj.filter = { and: conditions };
    } else if (conditions.length === 1) {
      filterObj.filter = conditions[0];
    }

    const data = await this.request(`/databases/${this.boardId}/query`, {
      method: 'POST',
      body: JSON.stringify({
        ...filterObj,
        sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
        page_size: 50,
      }),
    }) as NotionQueryResult;

    return data.results.map((page) => ({
      id: page.id,
      title: this.extractTitle(page.properties),
      status: this.extractSelect(page.properties, 'Status'),
      priority: this.extractSelect(page.properties, 'Priority'),
      assignee: this.extractPeople(page.properties, 'Assignee'),
      url: page.url,
      lastEdited: page.last_edited_time,
    }));
  }

  /** Get tickets by status for CTO context */
  async getTicketSummary(): Promise<string> {
    if (!this.isConfigured) return 'Notion not configured.';

    try {
      const tickets = await this.queryBoard();
      if (tickets.length === 0) return 'No tickets found.';

      const byStatus: Record<string, NotionPage[]> = {};
      for (const ticket of tickets) {
        const status = ticket.status || 'No Status';
        if (!byStatus[status]) byStatus[status] = [];
        byStatus[status].push(ticket);
      }

      let summary = '';
      for (const [status, items] of Object.entries(byStatus)) {
        summary += `**${status}** (${items.length}):\n`;
        for (const item of items.slice(0, 5)) {
          summary += `  - ${item.title}${item.priority ? ` [${item.priority}]` : ''}${item.assignee ? ` (${item.assignee})` : ''}\n`;
        }
        if (items.length > 5) summary += `  - ... and ${items.length - 5} more\n`;
      }
      return summary;
    } catch (err) {
      return `Notion error: ${(err as Error).message}`;
    }
  }

  /** Create a new ticket */
  async createTicket(params: {
    title: string;
    description?: string;
    status?: string;
    priority?: string;
  }): Promise<NotionPage> {
    if (!this.boardId) throw new Error('Notion board ID not configured');

    const properties: Record<string, unknown> = {
      Name: { title: [{ text: { content: params.title } }] },
    };

    if (params.status) {
      properties.Status = { status: { name: params.status } };
    }
    if (params.priority) {
      properties.Priority = { select: { name: params.priority } };
    }

    const children = params.description ? [{
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{ type: 'text', text: { content: params.description.slice(0, 2000) } }],
      },
    }] : [];

    try {
      const data = await this.request('/pages', {
        method: 'POST',
        body: JSON.stringify({
          parent: { database_id: this.boardId },
          properties,
          children,
        }),
      }) as { id: string; url: string; last_edited_time: string; properties: Record<string, NotionProperty> };

      return {
        id: data.id,
        title: params.title,
        status: params.status,
        priority: params.priority,
        url: data.url,
        lastEdited: data.last_edited_time,
      };
    } catch (err) {
      // If we had Status/Priority, retry without them (schema mismatch)
      if (params.status || params.priority) {
        console.warn(`[Notion] createTicket failed with Status/Priority, retrying with Name only: ${(err as Error).message}`);
        const fallbackProperties: Record<string, unknown> = {
          Name: { title: [{ text: { content: params.title } }] },
        };
        const data = await this.request('/pages', {
          method: 'POST',
          body: JSON.stringify({
            parent: { database_id: this.boardId },
            properties: fallbackProperties,
            children,
          }),
        }) as { id: string; url: string; last_edited_time: string; properties: Record<string, NotionProperty> };

        return {
          id: data.id,
          title: params.title,
          url: data.url,
          lastEdited: data.last_edited_time,
        };
      }
      throw err;
    }
  }

  /** Update a ticket's status */
  async updateTicketStatus(pageId: string, status: string): Promise<void> {
    await this.request(`/pages/${pageId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        properties: {
          Status: { status: { name: status } },
        },
      }),
    });
  }

  /** Get the full content of a Notion page as markdown */
  async getPageContent(pageId: string): Promise<string> {
    const data = await this.request(`/blocks/${pageId}/children?page_size=100`) as {
      results: NotionBlock[];
      has_more: boolean;
    };
    return this.blocksToMarkdown(data.results);
  }

  /** Get the creator of a Notion page, returning their email or name */
  async getPageCreator(pageId: string): Promise<{ name: string; email?: string } | null> {
    try {
      const page = await this.request(`/pages/${pageId}`) as {
        created_by: { id: string };
      };
      const user = await this.getNotionUser(page.created_by.id);
      if (!user) return null;
      return {
        name: user.name,
        email: user.person?.email,
      };
    } catch {
      return null;
    }
  }

  /** Look up a Notion user by ID (cached) */
  async getNotionUser(userId: string): Promise<NotionUser | null> {
    if (this.notionUserCache.has(userId)) {
      return this.notionUserCache.get(userId)!;
    }
    try {
      const user = await this.request(`/users/${userId}`) as NotionUser;
      this.notionUserCache.set(userId, user);
      return user;
    } catch {
      return null;
    }
  }

  /** Append markdown content to a Notion page as paragraph blocks */
  async appendToPage(pageId: string, markdown: string): Promise<void> {
    const lines = markdown.split('\n').filter(l => l.trim());
    const children = lines.map(line => ({
      object: 'block' as const,
      type: 'paragraph' as const,
      paragraph: {
        rich_text: [{ type: 'text' as const, text: { content: line } }],
      },
    }));

    await this.request(`/blocks/${pageId}/children`, {
      method: 'PATCH',
      body: JSON.stringify({ children }),
    });
  }

  /** Get a detailed ticket: page properties + full content + creator */
  async getDetailedTicket(pageId: string): Promise<{
    page: NotionPage;
    content: string;
    creator: { name: string; email?: string } | null;
  }> {
    const [pageData, content, creator] = await Promise.all([
      this.request(`/pages/${pageId}`) as Promise<{
        id: string; url: string; last_edited_time: string;
        properties: Record<string, NotionProperty>;
      }>,
      this.getPageContent(pageId),
      this.getPageCreator(pageId),
    ]);

    const page: NotionPage = {
      id: pageData.id,
      title: this.extractTitle(pageData.properties),
      status: this.extractSelect(pageData.properties, 'Status'),
      priority: this.extractSelect(pageData.properties, 'Priority'),
      assignee: this.extractPeople(pageData.properties, 'Assignee'),
      url: pageData.url,
      lastEdited: pageData.last_edited_time,
    };

    return { page, content, creator };
  }

  /** Convert Notion blocks to markdown */
  private blocksToMarkdown(blocks: NotionBlock[]): string {
    const lines: string[] = [];
    for (const block of blocks) {
      const richText = (rt: Array<{ plain_text: string }> | undefined) =>
        rt?.map(t => t.plain_text).join('') || '';

      switch (block.type) {
        case 'paragraph':
          lines.push(richText(block.paragraph?.rich_text));
          break;
        case 'heading_1':
          lines.push(`# ${richText(block.heading_1?.rich_text)}`);
          break;
        case 'heading_2':
          lines.push(`## ${richText(block.heading_2?.rich_text)}`);
          break;
        case 'heading_3':
          lines.push(`### ${richText(block.heading_3?.rich_text)}`);
          break;
        case 'bulleted_list_item':
          lines.push(`- ${richText(block.bulleted_list_item?.rich_text)}`);
          break;
        case 'numbered_list_item':
          lines.push(`1. ${richText(block.numbered_list_item?.rich_text)}`);
          break;
        case 'to_do':
          lines.push(`- [${block.to_do?.checked ? 'x' : ' '}] ${richText(block.to_do?.rich_text)}`);
          break;
        case 'code':
          lines.push(`\`\`\`${block.code?.language || ''}\n${richText(block.code?.rich_text)}\n\`\`\``);
          break;
        case 'callout':
          lines.push(`> ${richText(block.callout?.rich_text)}`);
          break;
        case 'divider':
          lines.push('---');
          break;
        case 'toggle':
          lines.push(`<details><summary>${richText(block.toggle?.rich_text)}</summary></details>`);
          break;
        default:
          break;
      }
    }
    return lines.join('\n');
  }

  private extractTitle(props: Record<string, NotionProperty>): string {
    for (const prop of Object.values(props)) {
      if (prop.type === 'title' && prop.title) {
        return prop.title.map(t => t.plain_text).join('');
      }
    }
    return 'Untitled';
  }

  private extractSelect(props: Record<string, NotionProperty>, name: string): string | undefined {
    const prop = props[name];
    if (prop?.type === 'select' && prop.select) return prop.select.name;
    if (prop?.type === 'status' && prop.status) return prop.status.name;
    return undefined;
  }

  private extractPeople(props: Record<string, NotionProperty>, name: string): string | undefined {
    const prop = props[name];
    if (prop?.type === 'people' && prop.people?.length) {
      return prop.people.map(p => p.name).join(', ');
    }
    return undefined;
  }
}

export const notionClient = new NotionClient();
