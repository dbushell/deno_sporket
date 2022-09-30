import * as base64 from 'https://deno.land/std@0.158.0/encoding/base64.ts';
import {
  signMessage,
  verifyMessage,
  parseMessage,
  ClientProps,
  Message,
  MessageType,
  MessageData
} from '../mod.ts';
import {MessageStatus} from './types.ts';

/**
 * A client of the Sporket server
 */
export class ServerClient extends EventTarget {
  #uuid: string;
  #name: string;
  #socket: WebSocket;
  #cryptoKey!: CryptoKey;
  #isAuthenticated = false;

  // WebSocket event handlers
  #onOpen: (ev: Event) => void;
  #onClose: (ev: CloseEvent) => void;
  #onMessage: (ev: MessageEvent) => void;
  #onError: (ev: Event) => void;

  /**
   * Create a new ServerClient instance
   * @param {ClientProps} props - configuration properties
   */
  constructor({uuid, socket}: ClientProps) {
    super();
    this.#uuid = uuid;
    this.#name = 'Unknown';
    this.#socket = socket;
    // Create key for signing and verifying messages
    crypto.subtle
      .importKey(
        'raw',
        new TextEncoder().encode(uuid),
        {name: 'HMAC', hash: 'SHA-256'},
        false,
        ['sign', 'verify']
      )
      .then((key) => (this.#cryptoKey = key));
    // Setup event listeners
    this.#onOpen = (ev: Event) => this.#handleOpen(ev);
    this.#onClose = (ev: CloseEvent) => this.#handleClose(ev);
    this.#onError = (ev: Event) => this.#handleError(ev);
    this.#onMessage = (ev: MessageEvent) => this.#handleMessage(ev);
    this.socket.addEventListener('open', this.#onOpen);
    this.socket.addEventListener('close', this.#onClose);
    this.socket.addEventListener('error', this.#onError);
    this.socket.addEventListener('message', this.#onMessage);
  }

  get uuid(): string {
    return this.#uuid;
  }

  get name(): string {
    return this.#name;
  }

  get socket(): WebSocket {
    return this.#socket;
  }

  /**
   * Returns true if the WebSocket is connected
   */
  get isConnected(): boolean {
    if (this.socket instanceof WebSocket) {
      return this.socket.readyState === WebSocket.OPEN;
    }
    return false;
  }

  get isAuthenticated(): boolean {
    return this.#isAuthenticated;
  }

  /**
   * Disconnect the WebSocket client and unauthenticate
   */
  disconnect(): void {
    this.socket.removeEventListener('open', this.#onOpen);
    this.socket.removeEventListener('close', this.#onClose);
    this.socket.removeEventListener('error', this.#onError);
    this.socket.removeEventListener('message', this.#onMessage);
    if (this.isConnected) {
      this.socket.close();
    }
    this.#isAuthenticated = false;
    this.dispatchEvent(new CustomEvent('disconnect'));
  }

  /**
   * Send a signed message to the WebSocket client
   * @param {MessageType} type - message type
   * @param {MessageStatus} status - message status
   * @param {MessageData} payload - message payload
   * @returns true if message was sent
   */
  async send(
    type: MessageType,
    status: MessageStatus,
    payload: MessageData = {}
  ): Promise<boolean> {
    if (!this.isConnected) {
      return false;
    }
    let message: Message = {
      id: type === MessageType.AUTH ? this.uuid : crypto.randomUUID(),
      now: Date.now(),
      type,
      status,
      payload: base64.encode(JSON.stringify(payload)),
      signature: ''
    };
    message = await signMessage(message, this.#cryptoKey);
    this.#socket.send(JSON.stringify(message));
    return true;
  }

  // deno-lint-ignore no-unused-vars
  #handleOpen(ev: Event): void {
    this.dispatchEvent(new CustomEvent('connect'));
  }

  // deno-lint-ignore no-unused-vars
  #handleClose(ev: CloseEvent): void {
    this.disconnect();
  }

  // deno-lint-ignore no-unused-vars
  #handleError(ev: Event): void {
    this.disconnect();
  }

  /**
   * Handle client WebSocket message
   */
  async #handleMessage(ev: MessageEvent): Promise<void> {
    const message = JSON.parse(ev.data) as Message;
    if (await verifyMessage(message, this.#cryptoKey)) {
      if (message.type === MessageType.AUTH) {
        return this.#handleAuth(message);
      }
      if (this.isAuthenticated) {
        // Forward verified unwrapped message data to server
        const payload = parseMessage(message);
        this.dispatchEvent(new CustomEvent('message', {detail: payload}));
      } else {
        await this.send(MessageType.ERROR, MessageStatus.UNAUTHORIZED, {
          message: 'Unauthorized (respond to challenge)'
        });
      }
    } else {
      await this.send(MessageType.ERROR, MessageStatus.BADREQUEST, {
        message: 'Bad Request (invalid signature)'
      });
    }
  }

  /**
   * Handle client WebSocket authentication message
   */
  async #handleAuth(message: Message): Promise<void> {
    try {
      const payload = parseMessage(message);
      if (typeof payload?.challenge !== 'string') {
        throw new Error();
      }
      const challenge = base64.encode(
        await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(
            Deno.env.get('SPORKET_PASSWORD') + this.#uuid
          )
        )
      );
      if (challenge !== payload.challenge) {
        throw new Error();
      }
      if (typeof payload?.name === 'string') {
        this.#name = payload.name;
      }
      this.#isAuthenticated = true;
      await this.send(MessageType.AUTH, MessageStatus.OK, {
        success: true
      });
      this.dispatchEvent(new CustomEvent('authenticated'));
    } catch {
      await this.send(MessageType.ERROR, MessageStatus.UNAUTHORIZED, {
        message: 'Unauthorized (authentication failed)'
      });
    }
  }
}
