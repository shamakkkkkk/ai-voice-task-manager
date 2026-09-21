// Pure translator: OpenAI Realtime server events → UI callbacks. No browser APIs in here, so it is unit-tested
// with recorded event fixtures.

/**
 * @param {{
 *   onPhase?: (p: 'listening'|'thinking'|'speaking') => void,
 *   onUserInterim?: (text: string) => void,
 *   onUserText?: (text: string) => void,
 *   onAssistantInterim?: (text: string) => void,
 *   onAssistantText?: (text: string) => void,
 *   onToolCalls?: (calls: {callId: string, name: string, args: object}[]) => void,
 *   onIdle?: () => void,
 *   onResponseEnd?: () => void,
 *   onError?: (message: string) => void,
 * }} cb
 */
export function createEventHandler(cb) {
  const userDraft = new Map(); // item_id → text so far
  const botDraft = new Map();
  const seenCalls = new Set();

  return function handle(event) {
    switch (event?.type) {
      case 'input_audio_buffer.speech_started':
        cb.onPhase?.('listening');
        break;
      case 'input_audio_buffer.speech_stopped':
        cb.onPhase?.('thinking');
        break;

      case 'conversation.item.input_audio_transcription.delta': {
        const text = (userDraft.get(event.item_id) ?? '') + (event.delta ?? '');
        userDraft.set(event.item_id, text);
        cb.onUserInterim?.(text.trim());
        break;
      }
      case 'conversation.item.input_audio_transcription.completed':
        userDraft.delete(event.item_id);
        if (event.transcript?.trim()) cb.onUserText?.(event.transcript.trim());
        break;

      case 'output_audio_buffer.started':
        cb.onPhase?.('speaking');
        break;
      case 'output_audio_buffer.stopped':
      case 'output_audio_buffer.cleared':
        cb.onIdle?.();
        break;

      case 'response.output_audio_transcript.delta': {
        // Some transports never send output_audio_buffer.* events: the first words of an answer also mean "speaking".
        if (!botDraft.has(event.item_id)) cb.onPhase?.('speaking');
        const text = (botDraft.get(event.item_id) ?? '') + (event.delta ?? '');
        botDraft.set(event.item_id, text);
        cb.onAssistantInterim?.(text.trim());
        break;
      }
      case 'response.output_audio_transcript.done':
        botDraft.delete(event.item_id);
        if (event.transcript?.trim()) cb.onAssistantText?.(event.transcript.trim());
        break;

      case 'response.done': {
        const calls = [];
        for (const item of event.response?.output ?? []) {
          if (item.type !== 'function_call' || seenCalls.has(item.call_id)) continue;
          seenCalls.add(item.call_id);
          let args = {};
          try {
            args = item.arguments ? JSON.parse(item.arguments) : {};
          } catch {
            args = {};
          }
          calls.push({ callId: item.call_id, name: item.name, args });
        }
        if (calls.length) {
          cb.onPhase?.('thinking');
          cb.onToolCalls?.(calls);
        } else if (event.response?.status === 'failed') {
          cb.onError?.(event.response?.status_details?.error?.message || 'response_failed');
        } else {
          cb.onResponseEnd?.();
        }
        break;
      }

      case 'error':
        cb.onError?.(event.error?.message || 'realtime_error');
        break;
      default:
        break;
    }
  };
}

/** Client events that hand a tool result back to the model and ask it to speak. */
export function toolOutputEvents(results) {
  return [
    ...results.map((r) => ({
      type: 'conversation.item.create',
      item: { type: 'function_call_output', call_id: r.callId, output: JSON.stringify(r.output) },
    })),
    { type: 'response.create' },
  ];
}
