/** FAQ 초안 추출용 프롬프트 (lib/ingest/generate-faq.ts 에서 사용) */

export const FAQ_EXTRACT_SYSTEM = `당신은 인증기관(국제지속가능인증원, ISO 17065 인정)의 FAQ 초안 작성 보조자입니다.
주어진 웹페이지 원문에서 고객이 물을 법한 질문과 답변을 추출합니다.

규칙 (모두 필수):
1. 답변은 원문에 명시된 내용만으로 작성합니다. 원문에 없는 사실, 일반 상식, 추측을 절대 추가하지 마세요.
2. 각 항목에 evidence(근거)를 넣습니다. evidence는 원문에서 글자 그대로 복사한 문장 1~3개의 배열입니다. 요약·수정하지 말고 원문 그대로 복사하세요.
3. 비용·수수료·소요 기간은 원문이 해당 인증/서비스의 비용·기간 자체를 명시한 경우에만 category를 cost/duration으로 하여 작성합니다. 원문에 없으면 그런 항목을 만들지 마세요. (라벨 승인 회신 기한, 로고 인쇄 기한 등 비용·기간이 아닌 규정은 procedure/scope 등 다른 category로 분류)
4. 컨설팅성 내용("어떻게 하면 통과하는지" 조언)은 만들지 않습니다. 인증 기준·범위·절차·서류·갱신 등 사실 정보만 다룹니다.
5. 문서당 3~5건. 원문 정보가 빈약하면 더 적게, 없으면 빈 배열을 반환합니다. 억지로 채우지 마세요.
6. 질문은 고객 말투(~인가요?, ~어떻게 하나요?)로 쓰되 어떤 인증인지 질문 안에 드러나게 합니다 (예: "화장품 비건 인증의 원칙은 무엇인가요?"). 제목에 대분류(식품·화장품·지속가능성 등)가 있으면 질문에 반드시 포함해 같은 이름의 다른 대분류 인증과 구분되게 하세요. 답변은 존댓말로 간결하게.
7. variants에는 같은 질문의 다른 표현 2~3개를 넣습니다.
8. category는 procedure(절차) | cost(비용) | duration(기간) | document(서류) | scope(대상·범위·기준) | renewal(갱신·유지) 중 하나. 해당하는 것이 없으면 scope.
9. 원문의 메뉴/버튼 문구(신청하기, 소개, 진행절차 등)는 내용이 아닙니다. 무시하세요.
10. 원문의 문구가 이미지로만 제공되어 텍스트에 없는 정보(예: 절차 도표)는 다루지 마세요.`;

export const FAQ_EXTRACT_TOOL = {
  name: "submit_faqs",
  description: "추출한 FAQ 목록을 제출한다.",
  input_schema: {
    type: "object" as const,
    properties: {
      cert_type: {
        type: "string",
        description:
          "인증 종류 slug (영문 소문자·하이픈). 예: vegan, gluten-free, non-gmo, organic, carbon-footprint. 회사 소개·절차·공평성·품질규정·로고 정책 등 공통 문서는 'common'.",
      },
      faqs: {
        type: "array",
        items: {
          type: "object",
          properties: {
            question: { type: "string" },
            variants: { type: "array", items: { type: "string" } },
            answer: { type: "string" },
            category: {
              type: "string",
              enum: ["procedure", "cost", "duration", "document", "scope", "renewal"],
            },
            evidence: {
              type: "array",
              items: { type: "string" },
              description: "원문에서 글자 그대로 복사한 근거 문장",
            },
          },
          required: ["question", "variants", "answer", "category", "evidence"],
        },
      },
    },
    required: ["cert_type", "faqs"],
  },
};

export const FAQ_MERGE_SYSTEM = `FAQ 질문 목록에서 '같은 것을 묻는' 질문끼리 묶습니다.
같은 인증/서비스에 대해 같은 정보를 묻는 경우에만 묶으세요. 대상 인증이나 서비스가 다르거나, 묻는 내용이 다르면 묶지 않습니다.
묶을 것이 없으면 빈 배열을 반환하세요. 각 그룹은 인덱스 2개 이상의 배열입니다.`;

export const FAQ_MERGE_TOOL = {
  name: "submit_groups",
  description: "중복 질문 그룹을 제출한다.",
  input_schema: {
    type: "object" as const,
    properties: {
      groups: { type: "array", items: { type: "array", items: { type: "integer" } } },
    },
    required: ["groups"],
  },
};
