export {Server} from './src/Server.ts';
export {ServerClient} from './src/ServerClient.ts';
export {Socket} from './src/Socket.ts';
export {Sporket} from './src/Sporket.ts';
export {MessageType, MessageStatus} from './src/types.ts';
export type {
  ClientProps,
  ServerProps,
  SocketProps,
  SporketProps,
  Message,
  MessageData
} from './src/types.ts';

import * as base64 from 'https://deno.land/std@0.158.0/encoding/base64.ts';
import {Message, MessageData} from './src/types.ts';

/**
 * Try to parse and return a message payload
 * @param message - data received via websocket
 * @returns {MessageData} parsed payload (or empty object on error)
 */
export const parseMessage = (message: Message): MessageData => {
  try {
    const payload = JSON.parse(
      new TextDecoder().decode(base64.decode(message.payload as string))
    );
    return payload;
  } catch {
    return {};
  }
};

/**
 * Sign a message with a given key
 * @param message - data received via websocket
 * @param cryptoKey - HMAC key
 * @returns {Promise<Message>} message with base64 signature property
 */
export const signMessage = async (
  message: Message,
  cryptoKey: CryptoKey
): Promise<Message> => {
  message.signature = base64.encode(
    await crypto.subtle.sign(
      'HMAC',
      cryptoKey,
      new TextEncoder().encode(message.id + message.now + message.payload)
    )
  );
  return message;
};

/**
 * Verify a message with a given key
 * @param message - data received via websocket
 * @param cryptoKey - HMAC key
 * @returns {Promise<boolean>} resolves true if signature is valid
 */
export const verifyMessage = async (
  message: Message,
  cryptoKey: CryptoKey
): Promise<boolean> => {
  if (!(cryptoKey instanceof CryptoKey)) {
    return Promise.resolve(false);
  }
  try {
    return await crypto.subtle.verify(
      'HMAC',
      cryptoKey,
      base64.decode(message.signature),
      new TextEncoder().encode(message.id + message.now + message.payload)
    );
  } catch {
    return Promise.resolve(false);
  }
};
