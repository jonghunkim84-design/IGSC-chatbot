import { ensureCertNames } from "@/lib/cert-registry";
import { runChat } from "@/lib/chat/run-chat";
import { MSG_ERROR_HANDOFF, MSG_RATE_LIMITED } from "@/lib/prompts/messages";
import { normalizeSource } from "@/lib/channels";
import { chatRules, checkRateLimit, getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_MESSAGE_LEN = 500;
const encoder = new TextEncoder();
const sse = (event: string, data: unknown) => encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

/**
 * POST /api/chat  { message, sessionId?, certType?, previousQuestion? }
 * SSE 스트림: meta({sessionId, route, sources, options}) → delta({text})* → done
 */
export async function POST(req: Request) {
  let body: { message?: unknown; sessionId?: unknown; certType?: unknown; previousQuestion?: unknown; source?: unknown; sourceDetail?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "JSON 본문이 필요합니다." }, { status: 400 });
  }
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return Response.json({ error: "message 가 필요합니다." }, { status: 400 });
  if (message.length > MAX_MESSAGE_LEN) {
    return Response.json({ error: `message 는 ${MAX_MESSAGE_LEN}자 이내여야 합니다.` }, { status: 400 });
  }
  const sessionId = typeof body.sessionId === "string" && body.sessionId.length <= 100 ? body.sessionId : undefined;
  const previousQuestion =
    typeof body.previousQuestion === "string" && body.previousQuestion.trim() && body.previousQuestion.length <= MAX_MESSAGE_LEN
      ? body.previousQuestion
      : undefined;
  const { source, source_detail: sourceDetail } = normalizeSource(body.source, body.sourceDetail);
  const certType = typeof body.certType === "string" && body.certType ? body.certType : undefined;

  const limit = await checkRateLimit(chatRules(getClientIp(req)));
  if (!limit.allowed) {
    console.warn(`[api/chat] 요청 제한 초과: ${limit.rule}`);
    return Response.json({ error: "rate_limited", message: MSG_RATE_LIMITED }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
  }

  await ensureCertNames(); // 이력 안내·되묻기 버튼의 인증 이름 (10분 캐시, 실패해도 기본값으로 계속)

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const ev of runChat({ message, sessionId, certType, previousQuestion, source, sourceDetail })) {
          if (ev.type === "meta") controller.enqueue(sse("meta", { sessionId: ev.sessionId, route: ev.route, sources: ev.sources, options: ev.options ?? [] }));
          else if (ev.type === "delta") controller.enqueue(sse("delta", { text: ev.text }));
          else controller.enqueue(sse("done", {}));
        }
      } catch (err) {
        console.error("[api/chat] 스트림 실패:", err);
        controller.enqueue(sse("delta", { text: MSG_ERROR_HANDOFF }));
        controller.enqueue(sse("done", {}));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
