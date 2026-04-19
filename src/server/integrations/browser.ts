/**
 * Browser automation for agents via Playwright MCP server.
 *
 * This enables engineers to interact with web UIs (Vanta, Salesforce, etc.)
 * by adding --mcp-server flag when spawning Claude CLI.
 *
 * The Playwright MCP server provides tools like:
 * - browser_navigate(url)
 * - browser_click(selector)
 * - browser_fill(selector, value)
 * - browser_screenshot()
 * - browser_get_text(selector)
 *
 * Setup:
 * 1. npm install -g @anthropic-ai/mcp-server-playwright (or use npx)
 * 2. Enable in Settings → Browser Automation
 */

import { getConfig } from '../config';

export interface BrowserConfig {
  enabled: boolean;
  mcpServerCommand: string;
  headless: boolean;
}

export function getBrowserMCPArgs(): string[] {
  const config = getConfig();
  if (!config.browserAutomationEnabled) return [];

  // Add the Playwright MCP server to the claude CLI args
  return [
    '--mcp-server', JSON.stringify({
      command: 'npx',
      args: ['-y', '@anthropic-ai/mcp-server-playwright'],
      env: {
        PLAYWRIGHT_HEADLESS: config.browserHeadless ? 'true' : 'false',
      },
    }),
  ];
}

/** Build enhanced engineer prompt that includes browser instructions */
export function buildBrowserInstructions(urls?: Record<string, string>): string {
  const config = getConfig();
  if (!config.browserAutomationEnabled) return '';

  let instructions = `
## Browser Automation
You have access to a browser via the Playwright MCP server. You can:
- Navigate to URLs
- Click elements
- Fill in forms
- Take screenshots
- Read text from pages

Use this for tasks that require interacting with web UIs.
`;

  if (urls && Object.keys(urls).length > 0) {
    instructions += '\nAvailable services:\n';
    for (const [name, url] of Object.entries(urls)) {
      instructions += `- ${name}: ${url}\n`;
    }
  }

  return instructions;
}
