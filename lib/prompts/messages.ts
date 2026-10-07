/**
 * 챗봇 고정 문구. 모델이 생성하지 않는 응답은 전부 여기서 온다.
 * 연락처는 igsc.kr 하단(푸터)과 불만처리절차 페이지 기준이며, 변경 시 이 파일만 수정한다.
 */

export const CONTACT_TEXT = "전화 02-858-4321 / 이메일 igsc@igsc.kr";

/** consulting: 방법론을 일절 포함하지 않는다. 공평성 안내 + 외부 컨설팅 경로. */
export const MSG_CONSULTING_BLOCKED = [
  "국제지속가능인증원은 ISO 17065에 따른 인증기관으로, 공평성 보장을 위해 인증 심사 대상에게 컨설팅을 제공하지 않습니다.",
  "따라서 인증 기준을 충족하거나 통과하는 방법에 대해서는 안내해 드릴 수 없습니다.",
  "개선·준비에 대한 도움이 필요하시면 외부 전문 컨설팅 기관을 통해 문의해 주세요.",
  "인증 절차, 비용, 기간, 필요 서류 등 공개된 정보는 언제든 문의하실 수 있습니다.",
].join("\n");

/** complaint: 담당자 즉시 연결 (접수 경로는 불만 및 이의제기 처리절차 페이지 기준) */
export const MSG_COMPLAINT = [
  "불만 및 이의제기는 담당자가 직접 확인하고 처리합니다.",
  "전화·방문·홈페이지 등으로 접수하실 수 있으며, 홈페이지에서는 이의제기/불만 접수 신청 양식을 작성해 'Q&A – 고객 불만'에 첨부해 주세요.",
  `빠른 연결이 필요하시면 ${CONTACT_TEXT} 로 문의해 주세요.`,
].join("\n");

export const MSG_OUT_OF_SCOPE =
  "이 챗봇은 국제지속가능인증원의 인증 관련 문의(가능 여부, 비용, 기간, 절차, 서류)만 안내해 드립니다. 인증과 관련된 질문을 입력해 주세요.";

/** FAQ에 근거가 없을 때 (searchFaq 빈 배열, 모델이 근거 부족 판단 등) */
export const MSG_HANDOFF = [
  "문의하신 내용은 현재 안내 가능한 자료에서 확인되지 않아 담당자 확인이 필요합니다.",
  "문의 내용은 담당자 확인 대상으로 기록되었습니다.",
  `빠른 확인이 필요하시면 ${CONTACT_TEXT} 로 문의해 주세요.`,
].join("\n");

/** FAQ로 일부만 안내한 답변 뒤에 붙는 담당자 연결 문구 (질문 중 안내하지 못한 부분을 담당자가 확인) */
export const MSG_PARTIAL_HANDOFF = [
  "안내드리지 못한 부분은 담당자 확인 대상으로 기록되었습니다.",
  `빠른 확인이 필요하시면 ${CONTACT_TEXT} 로 문의해 주세요.`,
].join("\n");

/** 부분 안내인데 모델의 마지막 연결 문장이 없을 때 시스템이 붙이는 문장 */
export const MSG_PARTIAL_FALLBACK_LINE = "말씀하신 나머지 내용은 담당자가 확인해 드립니다.";

/** 선택된 FAQ가 needs_input=true (담당자 입력 대기)일 때 */
export const MSG_NEEDS_INPUT_HANDOFF = [
  "해당 내용은 담당자 확인 후 안내드리는 항목입니다.",
  "문의 내용은 담당자 확인 대상으로 기록되었습니다.",
  `빠른 확인이 필요하시면 ${CONTACT_TEXT} 로 문의해 주세요.`,
].join("\n");

/** 시스템 오류 시 (에러는 로그에 남기고 사용자에게는 담당자 연결 안내) */
export const MSG_ERROR_HANDOFF = [
  "일시적인 문제로 답변을 드리지 못했습니다.",
  `담당자에게 직접 문의해 주세요. (${CONTACT_TEXT})`,
].join("\n");

/** 요청 제한(429) 초과 시 */
export const MSG_RATE_LIMITED = [
  "짧은 시간에 문의가 많아 잠시 후 다시 시도해 주세요.",
  `급하신 경우 담당자에게 직접 문의해 주세요. (${CONTACT_TEXT})`,
].join("\n");

/** 승인된 FAQ 가 한 건도 없을 때(공개 전·인계 직후) 인증 문의에 나가는 안내 */
export const MSG_PREPARING = [
  "AI 답변 준비 중입니다.",
  "문의하신 내용은 담당자 확인 대상으로 기록되었습니다.",
  `빠른 확인이 필요하시면 ${CONTACT_TEXT} 로 문의해 주세요.`,
].join("\n");

/** 비용·기간 FAQ를 근거로 한 답변에는 자동 첨부 */
export const MSG_COST_DURATION_DISCLAIMER =
  "※ 비용·기간 안내는 참고용이며, 담당자 검토 후 확정됩니다.";

/** 제품 인증 가능 여부 문의에는 자동 첨부 */
export const MSG_ELIGIBILITY_DISCLAIMER =
  "※ 인증 가능 여부는 제품 정보를 담당자가 검토한 뒤 확정됩니다. 위 안내는 인증 가능 여부를 보장하지 않습니다.";

export const MSG_HISTORY_INTRO =
  "참고로, 유사한 제품군에서 인증을 진행한 이력은 다음과 같습니다. (공개에 동의한 사례)";

export const MSG_SOURCES_LABEL = "참고 자료";

/** 질문에 인증 종류가 없고 FAQ 근거도 없을 때 되묻는 문구 */
export const MSG_CLARIFY_CERT =
  "어떤 인증에 대한 문의이신가요? 아래에서 선택하시거나 인증 종류를 직접 입력해 주세요.";

/** 한국어 외 언어로 들어온 인증 문의 (현재 한국어만 지원) */
export const MSG_LANGUAGE_UNSUPPORTED = [
  "현재 챗봇은 한국어 문의만 안내할 수 있습니다. 한국어로 다시 질문해 주시거나 담당자에게 문의해 주세요.",
  "This chatbot currently supports Korean only. Please contact our staff directly.",
  `(${CONTACT_TEXT})`,
].join("\n");

/** 제품 인증 가능 여부 문의인데 근거로 삼을 FAQ·이력이 없을 때 */
export const MSG_ELIGIBILITY_HANDOFF = [
  "제품의 인증 가능 여부는 제품 정보를 담당자가 직접 검토한 뒤 확정합니다. 현재 안내 가능한 자료로는 가능 여부를 말씀드릴 수 없습니다.",
  "문의 내용은 담당자 확인 대상으로 기록되었습니다.",
  `빠른 확인이 필요하시면 ${CONTACT_TEXT} 로 문의해 주세요.`,
].join("\n");

// ── 채팅 화면(UI) 고정 문구 ─────────────────────────────────────
/** 상담 신청 버튼이 새 창으로 여는 igsc.kr Q&A 폼 */
export const QNA_URL = "https://igsc.kr/contact/qna";

export const UI_HEADER = "IGSC 인증 문의를 안내해 드립니다.";
export const UI_GREETING =
  "안녕하세요, 국제지속가능인증원입니다. 궁금한 내용을 선택하시거나 직접 입력해 주세요.";
/** 하단 고정 문구 */
export const UI_FOOTER_DISCLAIMER = "안내된 비용과 기간은 참고용이며 담당자 검토 후 확정됩니다.";
export const UI_PRIVACY_HINT = "연락처 등 개인정보는 입력하지 마세요.";
export const UI_INPUT_PLACEHOLDER = "질문을 입력하세요";
export const UI_SEND = "전송";
export const UI_LOADING = "답변을 찾는 중입니다";
export const UI_CONSULT_BUTTON = "상담 신청";
export const UI_SOURCE_LABEL = "출처";

/** 시작 화면 추천 질문: [버튼 문구, 실제 전송 질문] */
export const UI_SUGGESTIONS: [string, string][] = [
  ["인증 비용", "인증 비용은 얼마인가요?"],
  ["소요 기간", "인증받는 데 얼마나 걸리나요?"],
  ["인증 절차", "인증 절차가 어떻게 되나요?"],
  ["인증 종류 안내", "어떤 인증을 받을 수 있나요?"],
];
