import {
  ServerClient,
  ServerProps,
  MessageType,
  MessageStatus,
  MessageData
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
  #port: number;
  #path: string;
  #server: Deno.Listener | undefined;
  #handles = new Map<string, Handle>();

  /**
   * Create a new Server instance
   * @param {ServerProps} props - configuration for the server
   */
  constructor(props: ServerProps = {}) {
    super();
    this.#port = props.port ?? 4455;
    this.#path = props.path ?? '/';
  }

  get url() {
    const url = new URL(this.#path, 'ws://localhost/');
    url.port = this.#port.toString();
    return url;
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
    if (this.#server) {
      this.#server.close();
    }
  }

  /**
   * Start the server and listen for connections
   */
  async listen(): Promise<void> {
    if (this.#server) {
      throw new Error('Server is already listening!');
    }
    console.log('Server listening on port:', this.port);
    this.#server = Deno.listen({port: this.port});
    for await (const conn of this.#server) {
      this.#handleConn(conn).catch((err) => {
        console.log(`Server error: ${err}`);
      });
    }
  }

  /**
   * Send a data message to all authenticated clients
   * @param {MessageData} payload  - data to send to the server
   * @returns true if the message was sent
   */
  async send(payload: MessageData): Promise<void> {
    for (const handle of this.#handles.values()) {
      if (handle.client.isAuthenticated) {
        await handle.client.send(MessageType.DATA, MessageStatus.OK, payload);
      }
    }
  }

  /**
   * Handle a new connection and upgrade WebSocket
   */
  async #handleConn(conn: Deno.Conn): Promise<void> {
    // deno-lint-ignore no-explicit-any
    const onError = (err: any) => {
      console.log(`Server respond error: ${err}`);
    };
    const httpConn = Deno.serveHttp(conn);
    for await (const {request, respondWith} of httpConn) {
      const url = new URL(request.url);
      if (new RegExp(`^${this.path}/?$`).test(url.pathname)) {
        const {socket, response} = Deno.upgradeWebSocket(request);
        this.#handleSocket(socket);
        respondWith(response).catch(onError);
        continue;
      }
      respondWith(
        new Response(null, {
          status: 404,
          statusText: '403 Forbidden'
        })
      ).catch(onError);
    }
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
      onMessage: (ev: CustomEvent<MessageData>) => this.#handleMessage(ev),
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
  }

  /**
   * Handle authenticated client `message` events
   */
  #handleMessage(ev: CustomEvent<MessageData>): void {
    // Forward verified unwrapped message data to wrapper
    this.dispatchEvent(new CustomEvent('message', {detail: ev.detail}));
  }

  #handleAuthenticated(ev: CustomEvent): void {
    // deno-lint-ignore no-unused-vars
    const client = ev.target as ServerClient;
    // TODO: dispatch event?
  }
}
