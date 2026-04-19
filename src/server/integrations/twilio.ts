import { getConfig } from '../config';
import { ctoSession } from '../cto-session';
import { eventBus } from '../event-bus';
import http from 'http';
import { URL } from 'url';

/**
 * Twilio integration for voice calls and SMS with the CTO agent.
 *
 * Setup:
 * 1. Get a Twilio account + phone number
 * 2. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER in Settings
 * 3. Configure Twilio webhooks:
 *    - Voice: POST http://<ngrok-or-public-url>:3102/voice
 *    - SMS:   POST http://<ngrok-or-public-url>:3102/sms
 * 4. Use ngrok for local dev: `ngrok http 3102`
 */

export class TwilioServer {
  private server: http.Server | null = null;
  private port = 3102;

  get isConfigured(): boolean {
    const config = getConfig();
    return !!(config.twilioAccountSid && config.twilioAuthToken && config.twilioPhoneNumber);
  }

  start(): void {
    if (!this.isConfigured) {
      console.log('[Twilio] Not configured — skipping. Set Twilio credentials in Settings.');
      return;
    }

    this.server = http.createServer(async (req, res) => {
      const url = new URL(req.url || '/', `http://localhost:${this.port}`);
      let body = '';

      req.on('data', (chunk) => { body += chunk; });
      req.on('end', async () => {
        const params = new URLSearchParams(body);

        try {
          if (url.pathname === '/sms') {
            await this.handleSMS(params, res);
          } else if (url.pathname === '/voice') {
            await this.handleVoiceIncoming(params, res);
          } else if (url.pathname === '/voice/gather') {
            await this.handleVoiceGather(params, res);
          } else {
            res.writeHead(404);
            res.end('Not found');
          }
        } catch (err) {
          console.error('[Twilio] Error:', err);
          res.writeHead(500);
          res.end('Internal error');
        }
      });
    });

    this.server.listen(this.port, () => {
      console.log(`[Twilio] Webhook server listening on port ${this.port}`);
    });
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  /** Handle incoming SMS — send to CTO, reply with response */
  private async handleSMS(params: URLSearchParams, res: http.ServerResponse): Promise<void> {
    const from = params.get('From') || '';
    const messageBody = params.get('Body') || '';

    console.log(`[Twilio] SMS from ${from}: ${messageBody}`);

    // Log it to the dashboard
    eventBus.emitDashboard({
      type: 'system:status',
      data: { engineers: 0, activeTasks: 0, dailyTokens: 0 },
    });

    // Get CTO response (this will also stream to dashboard)
    let ctoResponse = '';
    try {
      // Listen for the response
      const responsePromise = new Promise<string>((resolve) => {
        let timeout: ReturnType<typeof setTimeout>;
        const handler = (data: { fullText: string }) => {
          clearTimeout(timeout);
          eventBus.removeListener('cto:done', handler);
          resolve(data.fullText);
        };
        eventBus.on('cto:done', handler);
        // Timeout after 2 minutes
        timeout = setTimeout(() => {
          eventBus.removeListener('cto:done', handler);
          resolve('Sorry, I took too long to respond. Please try again.');
        }, 120000);
      });

      await ctoSession.sendMessage(`[SMS from CEO] ${messageBody}`);
      ctoResponse = await responsePromise;
    } catch (err) {
      ctoResponse = `Error: ${(err as Error).message}`;
    }

    // Truncate for SMS (1600 char limit)
    const smsResponse = ctoResponse.slice(0, 1500);

    // TwiML response
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${escapeXml(smsResponse)}</Message>
</Response>`;

    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(twiml);
  }

  /** Handle incoming voice call — greet and gather speech */
  private async handleVoiceIncoming(_params: URLSearchParams, res: http.ServerResponse): Promise<void> {
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Google.en-US-Neural2-D">Hello. I'm your CTO. What would you like to discuss?</Say>
  <Gather input="speech" action="/voice/gather" method="POST" speechTimeout="3" language="en-US">
    <Say voice="Google.en-US-Neural2-D">Go ahead.</Say>
  </Gather>
  <Say voice="Google.en-US-Neural2-D">I didn't hear anything. Goodbye.</Say>
</Response>`;

    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(twiml);
  }

  /** Handle voice speech input — get CTO response and speak it back */
  private async handleVoiceGather(params: URLSearchParams, res: http.ServerResponse): Promise<void> {
    const speechResult = params.get('SpeechResult') || '';
    console.log(`[Twilio] Voice speech: ${speechResult}`);

    let ctoResponse = '';
    try {
      const responsePromise = new Promise<string>((resolve) => {
        let timeout: ReturnType<typeof setTimeout>;
        const handler = (data: { fullText: string }) => {
          clearTimeout(timeout);
          eventBus.removeListener('cto:done', handler);
          resolve(data.fullText);
        };
        eventBus.on('cto:done', handler);
        timeout = setTimeout(() => {
          eventBus.removeListener('cto:done', handler);
          resolve('Sorry, I need more time to think about that. Let me get back to you on the dashboard.');
        }, 60000);
      });

      await ctoSession.sendMessage(`[Voice call from CEO] ${speechResult}`);
      ctoResponse = await responsePromise;
    } catch (err) {
      ctoResponse = `I encountered an error: ${(err as Error).message}`;
    }

    // Clean response for TTS (remove markdown, XML tags, etc.)
    const cleanResponse = ctoResponse
      .replace(/<task_assignment>[\s\S]*?<\/task_assignment>/g, 'I have some task suggestions which I\'ve added to the dashboard.')
      .replace(/[#*`]/g, '')
      .replace(/\n{2,}/g, '. ')
      .slice(0, 3000);

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Google.en-US-Neural2-D">${escapeXml(cleanResponse)}</Say>
  <Gather input="speech" action="/voice/gather" method="POST" speechTimeout="3" language="en-US">
    <Say voice="Google.en-US-Neural2-D">Is there anything else?</Say>
  </Gather>
  <Say voice="Google.en-US-Neural2-D">Alright, goodbye.</Say>
</Response>`;

    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(twiml);
  }

  /** Send an outbound SMS */
  async sendSMS(to: string, message: string): Promise<boolean> {
    const config = getConfig();
    if (!this.isConfigured) return false;

    try {
      const auth = Buffer.from(`${config.twilioAccountSid}:${config.twilioAuthToken}`).toString('base64');
      const body = new URLSearchParams({
        To: to,
        From: config.twilioPhoneNumber!,
        Body: message.slice(0, 1500),
      });

      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${config.twilioAccountSid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: body.toString(),
        }
      );

      return res.ok;
    } catch (err) {
      console.error('[Twilio] Send SMS error:', err);
      return false;
    }
  }
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export const twilioServer = new TwilioServer();
