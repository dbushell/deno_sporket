export interface ServerProps {
  hostname?: string;
  port?: number;
  path?: string;
}

export interface ClientProps {
  uuid: string;
  socket: WebSocket;
}

export interface SocketProps {
  url: URL;
  autoConnect?: boolean;
  maxAttempts?: number;
  minWaitTime?: number;
  maxWaitTime?: number;
  waitExtend?: number;
}

// deno-lint-ignore no-empty-interface
export interface SporketProps extends SocketProps {}

export enum MessageType {
  'AUTH' = 'AUTH',
  'PING' = 'PING',
  'DATA' = 'DATA',
  'ERROR' = 'ERROR'
}

export enum MessageStatus {
  OK = 200,
  BADREQUEST = 400,
  UNAUTHORIZED = 401,
  TEAPOT = 418,
  SERVERERROR = 500
}

export type PayloadType =
  | null
  | string
  | number
  | boolean
  | Array<PayloadType>
  | {[key: string]: PayloadType};

export interface Payload {
  [key: string]: PayloadType;
}

export interface Message {
  id: string;
  now: number;
  type: MessageType;
  status: MessageStatus;
  payload: string | Payload;
  signature: string;
}
