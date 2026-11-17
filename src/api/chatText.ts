import { SERVER_INSTRUCTIONS } from "../mcp/instructions";

export const CHAT_TEXT_PATH = "/api/chat-text";

/** The line the owner puts first in the claude.ai Instructions box; it exists only here, the page shows what the route returns. */
export const CHAT_PREFACE = 'You have the "board" connector (the agent progress board).';

/** What the "Set up a chat" panel shows and copies. */
export interface ChatTextResponse {
  text: string;
  preface: string;
}

/** The reporting rules an MCP client gets in `initialize`, read from the same constant, never a copy (Slice 19). */
export function chatTextResponse(): Response {
  const body: ChatTextResponse = { text: SERVER_INSTRUCTIONS, preface: CHAT_PREFACE };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
