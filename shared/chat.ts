export const CHAT_MAX_MESSAGES = 12;
export const CHAT_MAX_MESSAGE_CHARS = 4000;
export const CHAT_MAX_TOTAL_CHARS = 12_000;
export const CHAT_MAX_IMAGE_BYTES = 256_000;
export const CHAT_MAX_OUTPUT_TOKENS = 512;
export const CHAT_MAX_RESPONSE_CHARS = 8000;
export interface ChatMessageInput { sender: 'user' | 'ai'; text: string; image?: string }

/** Applied at the API boundary as well as by the browser. Reject oversized work; do not silently bill it. */
export function validateChatMessages(value: unknown): ChatMessageInput[] {
  if (!Array.isArray(value) || !value.length || value.length > CHAT_MAX_MESSAGES) throw new Error(`Send between 1 and ${CHAT_MAX_MESSAGES} messages.`);
  let characters = 0;
  let images = 0;
  for (const item of value) {
    if (!item || typeof item !== 'object' || !['user', 'ai'].includes(item.sender) || typeof item.text !== 'string' || item.text.length > CHAT_MAX_MESSAGE_CHARS) throw new Error('Invalid sender or oversized message.');
    characters += item.text.length;
    if (characters > CHAT_MAX_TOTAL_CHARS) throw new Error(`Conversation exceeds ${CHAT_MAX_TOTAL_CHARS} characters. Start a new chat.`);
    if (item.image !== undefined) {
      if (typeof item.image !== 'string' || ++images > 1) throw new Error('Only one image is allowed per request.');
      const match = item.image.match(/^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
      const decodedBytes = match ? match[1].length * 3 / 4 - (match[1].endsWith('==') ? 2 : match[1].endsWith('=') ? 1 : 0) : Infinity;
      if (!match || match[1].length % 4 !== 0 || decodedBytes > CHAT_MAX_IMAGE_BYTES) throw new Error(`Image must be PNG/JPEG/WebP and no larger than ${CHAT_MAX_IMAGE_BYTES} decoded bytes.`);
    }
    if (!item.text.trim() && !item.image) throw new Error('Empty message.');
  }
  if (value[value.length - 1].sender !== 'user') throw new Error('The last message must be from the user.');
  return value.map(m => ({ sender: m.sender, text: m.text, ...(m.image ? { image: m.image } : {}) }));
}

/** Bounded context sent by the browser; display history may be longer, but is also capped locally. */
export function boundedChatMessages(messages: readonly ChatMessageInput[]): ChatMessageInput[] {
  const recent = messages.slice(-CHAT_MAX_MESSAGES).map((m, i, arr) => ({ sender: m.sender, text: m.text.slice(0, CHAT_MAX_MESSAGE_CHARS),
    ...(i === arr.length - 1 && m.image ? { image: m.image } : {}) }));
  while (recent.length > 1 && recent.reduce((sum, m) => sum + m.text.length, 0) > CHAT_MAX_TOTAL_CHARS) recent.shift();
  while (recent.length > 1 && recent[0].sender === 'ai') recent.shift();
  return recent;
}
