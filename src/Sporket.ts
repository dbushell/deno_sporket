import * as base64 from 'https://deno.land/std@0.178.0/encoding/base64.ts';
import {
  Socket,
  SporketProps,
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
export class Sporket extends Socket {
  #uuid = '';
  #cryptoKey: CryptoKey | null = null;
  #isAuthenticated = false;

  /**
   * Create a new Sporket instance
   * @param {SporketProps} props - configuration for the client
   */
  constructor(props: SporketProps) {
    super(props);
    const reset = () => {
      this.#isAuthenticated = false;
      this.#cryptoKey = null;
      this.#uuid = '';
    };
    this.addEventListener('close', reset);
    this.addEventListener('disconnect', reset);
  }

  get uuid(): string {
    return this.#uuid;
  }

  /**
   * Returns true if the client is authenticated
   */
  get isAuthenticated(): boolean {
    return this.#isAuthenticated;
  }

  /**
   * Send a message to the Sporket server
   * @param {Payload} payload  - data to send to the server
   * @returns true if the message was sent
   */
  async send(
    payload: Payload,
    type = MessageType.DATA,
    status = MessageStatus.OK
  ): Promise<boolean> {
    if (!super.isConnected) {
      return false;
    }
    if (type !== MessageType.AUTH && !this.isAuthenticated) {
      return false;
    }
    let message = createMessage(payload, type, status);
    message = await signMessage(message, this.#cryptoKey!);
    this.socket.send(JSON.stringify(message));
    return true;
  }

  /**
   * Handle messages from the Sporket server
   * Base socket `message` event handler
   * @return {Message} parsed message if authenticated and verified
   */
  async handleMessage(ev: MessageEvent): Promise<void> {
    super.handleMessage(ev);
    const message = JSON.parse(ev.data) as Message;
    const payload = parseMessage(message);
    // First message should always be authentication
    if (message.type === MessageType.AUTH && 'uuid' in payload) {
      try {
        await this.#authenticate(message);
      } catch {
        this.disconnect();
      }
      return;
    }
    // Subsequent message signatures must be verified
    if (!(await verifyMessage(message, this.#cryptoKey!))) {
      this.disconnect();
      return;
    }
    // Second message should be challenge response
    if (message.type === MessageType.AUTH) {
      if (payload.success === true) {
        this.#isAuthenticated = true;
        this.dispatchEvent(new CustomEvent('authenticated'));
      } else {
        this.disconnect();
      }
      return;
    }
    if (message.type === MessageType.ERROR) {
      // Server has shut down
      if (message.status === MessageStatus.TEAPOT) {
        this.disconnect();
        return;
      }
      return;
    }
    // Forward verified unwrapped message data to wrapper
    this.dispatchEvent(new CustomEvent('message', {detail: payload}));
  }

  /**
   * Handle auth message from the Sporket server
   */
  async #authenticate(message: Message): Promise<void> {
    const payload = parseMessage(message);
    if (this.isAuthenticated) {
      throw new Error('Already authenticated');
    }
    if (typeof payload?.uuid !== 'string') {
      throw new Error('Invalid authentication payload');
    }
    // Create key for signing and verifying messages
    this.#cryptoKey = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(payload.uuid),
      {name: 'HMAC', hash: 'SHA-256'},
      false,
      ['sign', 'verify']
    );
    // Verify message signature
    if (!(await verifyMessage(message, this.#cryptoKey))) {
      throw new Error('Invalid authentication signature');
    }
    this.#uuid = payload.uuid;
    // Create challenge response to authenticate with API key
    const challenge = base64.encode(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(Deno.env.get('SPORKET_PASSWORD') + this.#uuid)
      )
    );
    this.send({challenge}, MessageType.AUTH);
  }
}
