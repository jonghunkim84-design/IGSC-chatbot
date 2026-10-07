import { ANSWER_SYSTEM, buildAnswerUserMessage } from "@/lib/prompts/answer";
import type { FaqMatch } from "@/lib/search";
import { ANSWER_MODEL, getAnthropic } from "./anthropic";

/** 4단계: 선택된 FAQ만 컨텍스트로 답변을 스트리밍 생성한다. */
export async function* streamAnswer(
  query: string,
  matches: FaqMatch[],
  opts: { eligibility: boolean },
): AsyncGenerator<string> {
  const stream = getAnthropic().messages.stream({
    model: ANSWER_MODEL,
    max_tokens: 1500, // 부분 안내의 마지막 문장(담당자 확인 연결)까지 잘리지 않게 여유를 둔다
    system: ANSWER_SYSTEM,
    messages: [
      {
        role: "user",
        content: buildAnswerUserMessage(
          query,
          matches.map((m) => ({ question: m.question, answer: m.answer })),
          opts,
        ),
      },
    ],
  });
  for await (const ev of stream) {
    if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") yield ev.delta.text;
  }
}
