export interface AssistantSections {
  conversation: string;
  readAloud: string | null;
}

/**
 * Parse assistant text that may contain "Conversation:" / "Read Aloud:" prefixes.
 * With the new two-phase system the AI should not mix sections, but we still
 * strip any leftover prefix labels for clean display.
 */
export function extractAssistantSections(text: string): AssistantSections | null {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return null;

  const conversationMatch = normalized.match(/(?:^|\n)\s*Conversation\s*:\s*/i);
  const readAloudMatch = normalized.match(/(?:^|\n)\s*Read\s*Aloud\s*:\s*/i);

  // If no prefix labels found, return the raw text as conversation content
  if (!conversationMatch && !readAloudMatch) {
    return { conversation: normalized, readAloud: null };
  }

  if (conversationMatch) {
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

  // Only Read Aloud prefix found (shouldn't happen often)
  if (readAloudMatch) {
    const content = normalized
      .slice((readAloudMatch.index ?? 0) + readAloudMatch[0].length)
      .trim();
    return { conversation: content, readAloud: null };
  }

  return null;
}

/**
 * Strip any "Conversation:" or "Read Aloud:" prefix from text for clean display.
 */
export function stripSectionPrefix(text: string): string {
  return text
    .replace(/^Conversation\s*:\s*/i, "")
    .replace(/^Read\s*Aloud\s*:\s*/i, "")
    .trim();
}
