export interface AssistantSections {
  conversation: string;
  readAloud: string | null;
}

export function extractAssistantSections(text: string): AssistantSections | null {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return null;

  const conversationMatch = normalized.match(/(?:^|\n)\s*Conversation\s*:\s*/i);
  if (!conversationMatch) return null;

  const readAloudMatch = normalized.match(/(?:^|\n)\s*Read\s*Aloud\s*:\s*/i);

  const conversationStart = (conversationMatch.index ?? 0) + conversationMatch[0].length;
  const conversationEnd = readAloudMatch?.index ?? normalized.length;
  const conversation = normalized.slice(conversationStart, conversationEnd).trim();

  const readAloud = readAloudMatch
    ? normalized
        .slice((readAloudMatch.index ?? 0) + readAloudMatch[0].length)
        .trim()
    : null;

  if (!conversation) return null;
  return {
    conversation,
    readAloud: readAloud && readAloud.length > 0 ? readAloud : null,
  };
}
