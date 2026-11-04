import { useEffect } from 'react';

interface StreamEvent {
  type: string;
  [key: string]: unknown;
}

/**
 * يتصل ببث المحرّك ويعيد الاتصال تلقائيًا. لا يرمي أخطاء إلى الواجهة:
 * انقطاع البث لا يجب أن يمنع استخدام التطبيق.
 */
export function connectEvents(onEvent: (event: StreamEvent) => void): () => void {
  const configured = window.workspace;
  if (!configured) return () => undefined;
  const apiBase = configured.apiBase;
  const token = configured.token;
  let stopped = false;
  let controller: AbortController | null = null;

  async function run(): Promise<void> {
    while (!stopped) {
      controller = new AbortController();
      try {
        const response = await fetch(
          `${apiBase}/api/stream?token=${encodeURIComponent(token)}`,
          { signal: controller.signal, headers: { accept: 'text/event-stream' } },
        );
        if (!response.ok || !response.body) throw new Error(`stream ${response.status}`);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (!stopped) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let boundary = buffer.indexOf('\n\n');
          while (boundary !== -1) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const dataLines = frame
              .split('\n')
              .filter((line) => line.startsWith('data:'))
              .map((line) => line.slice(5).trim());
            if (dataLines.length > 0) {
              try {
                onEvent(JSON.parse(dataLines.join('\n')) as StreamEvent);
              } catch {
                // إطار غير صالح لا يوقف البث.
              }
            }
            boundary = buffer.indexOf('\n\n');
          }
        }
      } catch {
        if (stopped) return;
        await new Promise((resolve) => setTimeout(resolve, 2500));
      }
    }
  }

  void run();
  return () => {
    stopped = true;
    controller?.abort();
  };
}

export function useEventStream(onEvent: (event: StreamEvent) => void): void {
  useEffect(() => connectEvents(onEvent), []);
}
