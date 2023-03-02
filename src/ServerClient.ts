import * as base64 from 'https://deno.land/std@0.178.0/encoding/base64.ts';
import {
  ClientProps,
  Message,
  MessageType,
  MessageStatus,
  Payload
} from '../mod.ts';
import {
  parseMessage,
  createMessage,
  signMessage,
  verifyMessage
} from './message.ts';

/**
 * A client of the Sporket server
 */
export class ServerClient extends EventTarget {
  #uuid: string;
  #socket: WebSocket;
  #controller: AbortController;
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
    this.#socket = socket;
    this.#controller = new AbortController();
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
    const {signal} = this.#controller;
    this.socket.addEventListener('open', this.#onOpen, {
      signal
    });
    this.socket.addEventListener('close', this.#onClose, {
      signal
    });
    this.socket.addEventListener('error', this.#onError, {
      signal
    });
    this.socket.addEventListener('message', this.#onMessage, {
      signal
    });
  }

  get uuid(): string {
    return this.#uuid;
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
    this.#controller.abort();
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
   * @param {Payload} payload - message payload
   * @returns true if message was sent
   */
  async send(
    type: MessageType,
    status: MessageStatus,
    payload: Payload = {}
  ): Promise<boolean> {
    if (!this.isConnected) {
      return false;
    }
    let message = createMessage(payload, type, status);
    message = await signMessage(message, this.#cryptoKey);
    this.socket.send(JSON.stringify(message));
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
