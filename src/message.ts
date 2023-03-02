import * as base64 from 'https://deno.land/std@0.178.0/encoding/base64.ts';
import {Message, MessageData, MessageType, MessageStatus} from '../mod.ts';

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
 * Return a message object with a blank signature
 * @param {MessageData} payload - message payload
 * @param {MessageType} type - message type
 * @param {MessageStatus} status - message status
 * @returns
 */
export const createMessage = (
  payload: MessageData,
  type: MessageType,
  status: MessageStatus
): Message => {
  return {
    id: crypto.randomUUID(),
    now: Date.now(),
    type,
    status,
    payload: base64.encode(JSON.stringify(payload)),
    signature: ''
  };
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
    return false;
  }
  try {
    return await crypto.subtle.verify(
      'HMAC',
      cryptoKey,
      base64.decode(message.signature),
      new TextEncoder().encode(message.id + message.now + message.payload)
    );
  } catch {
    return false;
  }
};
