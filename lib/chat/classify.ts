import {
  CLASSIFY_SYSTEM,
  QUESTION_LABELS,
  buildClassifyUserMessage,
  type QuestionLabel,
} from "@/lib/prompts/classify";
import { CLASSIFY_MODEL, getAnthropic } from "./anthropic";

export interface Classification {
  label: QuestionLabel;
  /** 제품의 인증 가능 여부를 묻는 질문 (label=allowed 일 때만 의미) */
  eligibility: boolean;
  /** 질문에 특정 인증 종류가 언급되었는가. false면 검색 결과가 없을 때 인증 종류를 되묻는다. */
  certSpecified: boolean;
}

export function parseClassification(text: string): Classification {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) throw new Error(`분류 응답에서 JSON을 찾지 못함: ${text.slice(0, 100)}`);
  const obj = JSON.parse(m[0]) as { label?: unknown; eligibility?: unknown; cert_specified?: unknown };
  if (!QUESTION_LABELS.includes(obj.label as QuestionLabel)) {
    throw new Error(`알 수 없는 분류 값: ${String(obj.label)}`);
  }
  return { label: obj.label as QuestionLabel, eligibility: obj.eligibility === true,
    certSpecified: obj.cert_specified !== false, // 누락 시 true (되묻기 대신 기존 흐름 유지)
  };
}

/** 1단계: 질문 분류. 형식 오류·API 오류는 throw → 호출측이 로깅 후 담당자 연결 안내. */
export async function classifyQuestion(query: string): Promise<Classification> {
  const res = await getAnthropic().messages.create({
    model: CLASSIFY_MODEL,
    max_tokens: 80,
    temperature: 0,
    system: CLASSIFY_SYSTEM,
    messages: [{ role: "user", content: buildClassifyUserMessage(query) }],
  });
  const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  return parseClassification(text);
}
