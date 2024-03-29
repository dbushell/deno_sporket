import {
  ServerClient,
  ServerProps,
  MessageType,
  MessageStatus,
  Payload
} from '../mod.ts';

export interface Handle {
  client: ServerClient;
  onConnect: (ev: CustomEvent) => void;
  onDisconnect: (ev: CustomEvent) => void;
  onAuthenticated: (ev: CustomEvent) => void;
  onMessage: (ev: CustomEvent) => void;
}

/**
 * The Sporket server
 */
export class Server extends EventTarget {
  #hostname: string;
  #port: number;
  #path: string;
  #abort: AbortController | undefined;
  #handles = new Map<string, Handle>();

  /**
   * Create a new Server instance
   * @param {ServerProps} props - configuration for the server
   */
  constructor(props: ServerProps = {}) {
    super();
    this.#hostname = props.hostname ?? 'localhost';
    this.#port = props.port ?? 9000;
    this.#path = props.path ?? '/';
  }

  get url() {
    const url = new URL(this.#path, `ws://${this.hostname}/`);
    url.port = this.#port.toString();
    return url;
  }

  get hostname(): string {
    return this.#hostname;
  }

  get port(): number {
    return this.#port;
  }

  get path(): string {
    return this.#path;
  }

  /**
   * Gracefully close the server informing all clients
   */
  async close(): Promise<void> {
    // Send closing message to authenticated clients
    for (const handle of this.#handles.values()) {
      if (handle.client.isAuthenticated) {
        await handle.client.send(MessageType.ERROR, MessageStatus.TEAPOT);
      }
    }
    // Wait a second before force closing open clients
    await new Promise((resolve) => setTimeout(resolve, 1000));
    for (const handle of this.#handles.values()) {
      handle.client.disconnect();
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (this.#abort && !this.#abort.signal.aborted) {
      this.#abort.abort();
    }
  }

  /**
   * Send a data message to all authenticated clients
   * @param {Payload} payload  - data to send to the server
   */
  async send(payload: Payload): Promise<void> {
    for (const handle of this.#handles.values()) {
      if (handle.client.isAuthenticated) {
        await handle.client.send(MessageType.DATA, MessageStatus.OK, payload);
      }
    }
  }

  /**
   * Send a data message to a single authenticated client
   * @param {string} uuid - the client uuid
   * @param {Payload} payload  - data to send to the server
   * @returns true if the message was sent
   */
  async sendTo(uuid: string, payload: Payload): Promise<boolean> {
    const client = this.#handles.get(uuid)?.client;
    if (client && client.isAuthenticated) {
      await client.send(MessageType.DATA, MessageStatus.OK, payload);
      return true;
    }
    return false;
  }

  /**
   * Start the server and listen for connections
   */
  listen(): void {
    if (this.#abort) {
      throw new Error('Server is already listening!');
    }
    this.#abort = new AbortController();
    Deno.serve(
      {
        signal: this.#abort.signal,
        hostname: this.hostname,
        port: this.port,
        onListen({port, hostname}: {port: number; hostname: string}) {
          console.log(`Listening on http://${hostname}:${port}`);
        }
      },
      (request: Request) => {
        const url = new URL(request.url);
        if (new RegExp(`^${this.path}/?$`).test(url.pathname)) {
          const {socket, response} = Deno.upgradeWebSocket(request);
          this.#handleSocket(socket);
          return response;
        }
        return this.handleRequest(request);
      }
    );
  }

  // deno-lint-ignore no-unused-vars
  handleRequest(request: Request): Response {
    return new Response(null, {
      status: 404,
      statusText: 'Not Found'
    });
  }

  /**
   * Handle a new WebSocket and setup the client
   */
  #handleSocket(socket: WebSocket): void {
    const uuid = crypto.randomUUID();
    const client = new ServerClient({uuid, socket});
    const handle = {
      client,
      onConnect: (ev: CustomEvent) => this.#handleConnect(ev),
      onDisconnect: (ev: CustomEvent) => this.#handleDisconnect(ev),
      onMessage: (ev: CustomEvent<Payload>) => this.#handleMessage(ev),
      onAuthenticated: (ev: CustomEvent) => this.#handleAuthenticated(ev)
    };
    client.addEventListener('connect', handle.onConnect as EventListener);
    client.addEventListener('disconnect', handle.onDisconnect as EventListener);
    client.addEventListener(
      'authenticated',
      handle.onAuthenticated as EventListener
    );
    client.addEventListener('message', handle.onMessage as EventListener);
    this.#handles.set(uuid, handle);
  }

  /**
   * Handle client `connect` events
   */
  #handleConnect(ev: Event): void {
    const client = ev.target as ServerClient;
    if (!this.#handles.has(client.uuid)) {
      return;
    }
    client.send(MessageType.AUTH, MessageStatus.OK, {uuid: client.uuid});
  }

  /**
   * Handle client `disconnect` events
   */
  #handleDisconnect(ev: Event): void {
    const client = ev.target as ServerClient;
    if (!this.#handles.has(client.uuid)) {
      return;
    }
    const handle = this.#handles.get(client.uuid)!;
    client.removeEventListener('connect', handle.onConnect as EventListener);
    client.removeEventListener(
      'disconnect',
      handle.onDisconnect as EventListener
    );
    client.removeEventListener(
      'authenticated',
      handle.onAuthenticated as EventListener
    );
    client.removeEventListener('message', handle.onMessage as EventListener);
    this.#handles.delete(client.uuid);
    this.dispatchEvent(
      new CustomEvent('clientdisconnect', {
        detail: {uuid: client.uuid}
      })
    );
  }

  /**
   * Handle authenticated client `message` events
   */
  #handleMessage(ev: CustomEvent<Payload>): void {
    // Forward verified unwrapped message data to wrapper
    const client = ev.target as ServerClient;
    this.dispatchEvent(
      new CustomEvent('message', {detail: {...ev.detail, uuid: client.uuid}})
    );
  }

  #handleAuthenticated(ev: CustomEvent): void {
    const client = ev.target as ServerClient;
    this.dispatchEvent(
      new CustomEvent('clientconnect', {
        detail: {uuid: client.uuid}
      })
    );
  }
}
