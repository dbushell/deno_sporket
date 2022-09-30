import {SocketProps, MessageData} from './types.ts';

/**
 * Base class to manage a WebSocket connection
 */
export class Socket extends EventTarget {
  #url: URL;
  #socket!: WebSocket;

  // Auto-reconnect if WebSocket closes
  #autoConnect: boolean;
  // Maxiumum number of reconnect attempts
  #maxAttempts: number;
  // Minimum time to wait before reconnect (ms)
  #minWaitTime: number;
  // Maxiumum time to wait before reconnect (ms)
  #maxWaitTime: number;
  // Extend wait time on failed attempt (ms)
  #waitExtend: number;
  // Current wait time before reconnect (ms)
  #waitTime: number;
  // Current reconnect attempt count
  #attemptCount: number;
  // Reconnect timeout
  #attemptTimeout: number;

  // WebSocket event handlers
  #onOpen: (ev: Event) => void;
  #onClose: (ev: CloseEvent) => void;
  #onMessage: (ev: MessageEvent) => void;
  #onError: (ev: Event) => void;

  /**
   * Create a new Socket instance
   * @param {SocketProps} props - configuration for the socket properties
   */
  constructor(props: SocketProps) {
    super();
    this.#url = new URL(props.url);

    // Setup properties
    this.#autoConnect = props.autoConnect ?? true;
    this.#maxAttempts = props.maxAttempts ?? 10;
    this.#minWaitTime = props.minWaitTime ?? 2000;
    this.#maxWaitTime = props.maxWaitTime ?? 10000;
    this.#waitExtend = props.waitExtend ?? 1000;
    this.#waitTime = 1000;
    this.#attemptCount = 0;
    this.#attemptTimeout = 0;

    // Setup event handlers
    this.#onOpen = (ev: Event) => this.handleOpen(ev);
    this.#onClose = (ev: CloseEvent) => this.handleClose(ev);
    this.#onError = (ev: Event) => this.handleError(ev);
    this.#onMessage = (ev: MessageEvent) => this.handleMessage(ev);

    // Connect immediately if auto-reconnect is enabled
    if (this.#autoConnect) {
      this.connect();
    }
  }

  /**
   * Return the WebSocket instance
   */
  get socket(): WebSocket {
    return this.#socket;
  }

  /**
   * Returns true if the WebSocket is connected
   */
  get isConnected(): boolean {
    if (this.#socket instanceof WebSocket) {
      return this.#socket.readyState === WebSocket.OPEN;
    }
    return false;
  }

  /**
   * Attempt to connect the WebSocket
   * (`connect` event is dispatched after open)
   */
  connect(): void {
    clearTimeout(this.#attemptTimeout);
    if (this.#socket instanceof WebSocket) {
      this.disconnect();
    }
    this.#socket = new WebSocket(this.#url.href);
    this.#socket.addEventListener('open', this.#onOpen);
    this.#socket.addEventListener('close', this.#onClose);
    this.#socket.addEventListener('error', this.#onError);
    this.#socket.addEventListener('message', this.#onMessage);
  }

  /**
   * Disconnect the WebSocket
   * (`close` event is dispatched if socket was open)
   * (`disconnect` event is dispatched)
   */
  disconnect(): void {
    clearTimeout(this.#attemptTimeout);
    if (!(this.#socket instanceof WebSocket)) {
      return;
    }
    this.#socket.removeEventListener('open', this.#onOpen);
    this.#socket.removeEventListener('close', this.#onClose);
    this.#socket.removeEventListener('error', this.#onError);
    this.#socket.removeEventListener('message', this.#onMessage);
    if (this.#socket.readyState < WebSocket.CLOSING) {
      this.#socket.close();
    }
    this.dispatchEvent(new CustomEvent('disconnect'));
  }

  /**
   * Send JSON via the WebSocket
   * @param {MessageData} data - data to send
   */
  sendJSON(data: MessageData) {
    if (this.isConnected) {
      this.#socket.send(JSON.stringify(data));
    }
  }

  // deno-lint-ignore no-unused-vars
  handleOpen(ev: Event): void {
    this.#waitTime = this.#minWaitTime;
    this.#attemptCount = 0;
    this.dispatchEvent(new CustomEvent('connect'));
  }

  // deno-lint-ignore no-unused-vars
  handleClose(ev: Event): void {
    setTimeout(() => {
      this.dispatchEvent(new CustomEvent('close'));
    }, 1);
    clearTimeout(this.#attemptTimeout);
    if (this.#maxAttempts > 0 && this.#attemptCount++ >= this.#maxAttempts) {
      this.disconnect();
      return;
    }
    if (!this.#autoConnect) {
      return;
    }
    this.#attemptTimeout = setTimeout(() => {
      this.connect();
    }, this.#waitTime);
    this.#waitTime += this.#waitExtend;
    if (this.#waitTime > this.#maxWaitTime) {
      this.#waitTime = this.#maxWaitTime;
    }
  }

  // deno-lint-ignore no-unused-vars
  handleError(ev: Event): void {
    // No nothing...
  }

  // deno-lint-ignore no-unused-vars
  handleMessage(ev: MessageEvent): void {
    // Do nothing...
  }
}
