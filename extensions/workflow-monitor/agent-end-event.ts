export type AgentEndEvent = {
  agent?: string;
  agentName?: string;
  messages?: AgentMessage[];
  message?: AgentMessage;
};

export type AgentMessage = {
  role?: string;
  content?: unknown;
  stopReason?: string;
  diagnostics?: Array<{ type?: string }>;
};

export function textFromMessage(message: AgentMessage | undefined): string {
  if (!message) return '';
  if (typeof message.content === 'string') return message.content;
  if (!Array.isArray(message.content)) return '';
  return message.content
    .map((part) =>
      typeof part === 'object' &&
      part !== null &&
      'type' in part &&
      part.type === 'text' &&
      'text' in part &&
      typeof part.text === 'string'
        ? part.text
        : '',
    )
    .filter(Boolean)
    .join('\n');
}

export function latestAssistantMessage(
  event: AgentEndEvent,
): AgentMessage | undefined {
  const messages = event.messages ?? (event.message ? [event.message] : []);
  return (
    [...messages].reverse().find((message) => message.role === 'assistant') ??
    messages.at(-1)
  );
}

export function latestAssistantText(event: AgentEndEvent): string {
  return textFromMessage(latestAssistantMessage(event));
}

export function agentEndedWithProviderTransportFailure(
  event: AgentEndEvent,
): boolean {
  const message = latestAssistantMessage(event);
  return Boolean(
    message?.stopReason === 'error' &&
    message.diagnostics?.some(
      (diagnostic) => diagnostic.type === 'provider_transport_failure',
    ),
  );
}
