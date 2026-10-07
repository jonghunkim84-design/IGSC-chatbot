export interface CertOptionDto {
  certType: string;
  label: string;
}

export interface MetaEvent {
  sessionId: string;
  route: string;
  sources: string[];
  options: CertOptionDto[];
}

export type SseEvent =
  | { event: "meta"; data: MetaEvent }
  | { event: "delta"; data: { text: string } }
  | { event: "done"; data: Record<string, never> };

/** fetch 응답 본문(SSE)을 이벤트 단위로 읽는다. */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 2);
      const m = /^event: (\w+)\ndata: ([\s\S]*)$/.exec(block);
      if (m) yield { event: m[1], data: JSON.parse(m[2]) } as SseEvent;
    }
  }
}
