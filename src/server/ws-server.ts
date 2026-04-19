import { WebSocketServer, WebSocket } from 'ws';
import { eventBus, DashboardEvent } from './event-bus';

export class WsServer {
  private wss: WebSocketServer | null = null;
  private clients: Set<WebSocket> = new Set();

  start(port: number): void {
    this.wss = new WebSocketServer({ port });

    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      console.log(`[WS] Client connected (total: ${this.clients.size})`);

      ws.on('close', () => {
        this.clients.delete(ws);
        console.log(`[WS] Client disconnected (total: ${this.clients.size})`);
      });

      ws.on('error', (err) => {
        console.error('[WS] Client error:', err.message);
        this.clients.delete(ws);
      });
    });

    // Forward all dashboard events to WebSocket clients
    eventBus.on('dashboard', (event: DashboardEvent) => {
      this.broadcast(event);
    });

    console.log(`[WS] Server listening on port ${port}`);
  }

  broadcast(event: DashboardEvent): void {
    const msg = JSON.stringify(event);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }
  }

  getClientCount(): number {
    return this.clients.size;
  }

  close(): void {
    if (this.wss) {
      for (const client of this.clients) {
        client.close();
      }
      this.wss.close();
      this.wss = null;
    }
  }
}

export const wsServer = new WsServer();
