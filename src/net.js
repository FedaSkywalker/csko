// Browser side of a multiplayer session: one WebSocket to one game room on the Node server.
import { NET_PROTOCOL } from './config.js';

export class NetClient {
  constructor({ onMessage, onClose }) {
    this.onMessage = onMessage;
    this.onClose = onClose;
    this.ws = null;
    this.closedByUs = false;
    this.established = false;
  }

  // target: { host: 'localhost:3000' | 'strike.example.com', room: 'dustline', protocol: 'ws' | 'wss' }
  connect(target, hello) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer = 0;
      const done = (fn, v) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(v);
      };
      let ws;
      try {
        ws = new WebSocket(`${target.protocol}://${target.host}/ws/${encodeURIComponent(target.room)}`);
      } catch (e) {
        reject(e);
        return;
      }
      this.ws = ws;
      timer = setTimeout(() => {
        done(reject, new Error('The server did not answer (timeout).'));
        try { ws.close(); } catch { /* ignore */ }
      }, 8000);
      ws.addEventListener('open', () => ws.send(JSON.stringify({ t: 'join', v: NET_PROTOCOL, ...hello })));
      ws.addEventListener('message', (ev) => {
        if (typeof ev.data !== 'string') return;
        let m;
        try { m = JSON.parse(ev.data); } catch { return; }
        if (m.t === 'welcome') {
          this.established = true;
          done(resolve, m);
        } else if (m.t === 'error') {
          done(reject, new Error(m.msg || 'Server refused the connection.'));
        }
        this.onMessage(m);
      });
      ws.addEventListener('error', () => done(reject, new Error(`Cannot connect to ${target.host}.`)));
      ws.addEventListener('close', (e) => {
        done(reject, new Error(e.reason || 'Connection closed.'));
        if (!this.closedByUs && this.established) this.onClose(e);
      });
    });
  }

  send(obj) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  get buffered() {
    return this.ws ? this.ws.bufferedAmount : 0;
  }

  close() {
    this.closedByUs = true;
    if (this.ws) {
      try { this.ws.close(); } catch { /* ignore */ }
    }
    this.ws = null;
  }
}
