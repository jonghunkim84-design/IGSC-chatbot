import Anthropic from "@anthropic-ai/sdk";
import {
  SELECT_MAX,
  SELECT_SYSTEM,
  buildFaqListBlock,
  buildSelectUserMessage,
  type FaqListItem,
} from "@/lib/prompts/select";

const MODEL = process.env.SEARCH_MODEL ?? "claude-haiku-4-5-20251001";

let client: Anthropic | null = null;
const getClient = () => (client ??= new Anthropic());

/**
 * Claude가 돌려준 텍스트에서 번호 배열을 파싱하고 검증한다. 형식이 틀리면 throw.
 * 모델이 번호를 너무 많이 내서 응답이 중간에 잘린 경우("[2, 3, 10, 13 …" 처럼 닫는 대괄호가 없음)에는
 * 읽을 수 있는 앞쪽 번호(관련도 높은 순)만 쓰고 상한(SELECT_MAX)으로 자른다. 이 오류로 고객 응답이 실패하지 않게 한다.
 */
export function parseSelection(text: string, listLength: number): number[] {
  const closed = /\[[^\]]*\]/.exec(text);
  let arr: unknown[];
  if (closed) {
    const parsed: unknown = JSON.parse(closed[0]);
    if (!Array.isArray(parsed)) throw new Error("선택 응답이 배열이 아님");
    arr = parsed;
  } else {
    const open = /\[([^\]]*)$/.exec(text);
    if (!open) throw new Error(`선택 응답에서 JSON 배열을 찾지 못함: ${text.slice(0, 100)}`);
    // 잘린 응답: 마지막 번호는 중간에 끊겼을 수 있으니 완전한 번호(뒤에 쉼표가 있는 것)만 쓴다
    arr = [...open[1].matchAll(/(\d+)\s*,/g)].map((m) => Number(m[1]));
  }
  const nums: number[] = [];
  for (const v of arr) {
    if (!Number.isInteger(v)) throw new Error(`정수가 아닌 값: ${String(v)}`);
    const n = v as number;
    if (n < 1 || n > listLength) continue; // 목록에 없는 번호는 버린다
    if (!nums.includes(n)) nums.push(n);
  }
  return nums.slice(0, SELECT_MAX);
}

/** 목록에서 고객 질문과 관련된 항목의 0-based 인덱스를 고른다 (최대 SELECT_MAX=5개, 없으면 []). */
export async function selectFaqIndexes(query: string, list: FaqListItem[], opts: { commonOnly?: boolean } = {}): Promise<number[]> {
  const res = await getClient().messages.create({
    model: MODEL,
    max_tokens: 100,
    temperature: 0,
    system: [
      { type: "text", text: SELECT_SYSTEM },
      // FAQ 목록은 고객 질문과 무관하게 동일하므로 캐싱 대상 (고객 질문은 user 메시지로 분리)
      { type: "text", text: buildFaqListBlock(list), cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: buildSelectUserMessage(query, opts) }],
  });
  const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  return parseSelection(text, list.length).map((n) => n - 1);
}
