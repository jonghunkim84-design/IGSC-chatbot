export type FaqCategory =
  | "procedure"
  | "cost"
  | "duration"
  | "document"
  | "scope"
  | "renewal";

export type FaqStatus = "draft" | "approved";

export type ChatRoute =
  | "answered"
  | "consulting_blocked"
  | "handoff"
  | "complaint";

export interface Faq {
  id: string;
  question: string;
  variants: string[];
  answer: string;
  cert_type: string;
  category: FaqCategory;
  source_url: string | null;
  lang: string;
  status: FaqStatus;
  needs_input: boolean;
  /** 업로드 문서에서 만든 초안이면 그 문서·페이지·근거 원문 (Phase 10) */
  source_doc_id: string | null;
  source_page: number | null;
  /** 출처 문서가 개정·삭제되어 재검토가 필요 (approved 는 유지되어 계속 서비스된다) */
  needs_review: boolean;
  review_reason: "revised" | "deleted" | null;
  review_note: string | null;
  review_flagged_at: string | null;
  /** 자동 초안 결과 메모 (근거를 못 찾은 사유 등) */
  draft_note: string | null;
  source_evidence: string[];
  source_unanswered_id: string | null;
  created_at: string;
  updated_at: string;
  /** 문서 검수 큐에서 보류한 초안 (0008). 마이그레이션 전에는 없을 수 있다. */
  review_hold?: boolean;
  /** 승인한 관리자 이메일과 시각 (0010). 승인된 FAQ 에만 있고, 이전에 승인한 FAQ 는 비어 있다. */
  approved_by?: string | null;
  approved_at?: string | null;
}

export interface CertHistory {
  id: string;
  cert_type: string;
  product_category: string | null;
  company_public: boolean;
  company_name: string | null;
  year: number | null;
}

export interface ChatLog {
  id: string;
  session_id: string;
  question: string;
  answer: string | null;
  matched_faq_ids: string[];
  route: ChatRoute;
  created_at: string;
  /** 유입 채널(링크의 src). 0012 적용 전 행·직접 입력은 null */
  source?: string | null;
  /** 캠페인 이름 또는 other 의 원래 코드 */
  source_detail?: string | null;
}

export interface Unanswered {
  id: string;
  question: string;
  chat_log_id: string | null;
  resolved: boolean;
  created_at: string;
  /** 관리자 목록에서만 채워진다: 챗봇이 일부는 안내하고 나머지를 담당자 확인으로 넘긴 건 (연결된 chat_log.route = 'answered') */
  partial?: boolean;
}

export type NewFaq = Pick<Faq, "question" | "answer" | "cert_type" | "category"> &
  Partial<Pick<Faq, "variants" | "source_url" | "lang" | "status" | "needs_input">>;

export type NewChatLog = Pick<ChatLog, "session_id" | "question" | "route"> &
  Partial<Pick<ChatLog, "answer" | "matched_faq_ids" | "source" | "source_detail">>;

export type DocStatus = "pending" | "extracted" | "failed" | "archived";
export type DocFormat = "narrative" | "qa_pairs";
export type DocCategoryType = "procedure" | "fee" | "form" | "policy" | "other";

/** 관리자가 업로드한 문서 (FAQ 초안을 만드는 재료. 고객 답변의 근거가 아니다) */
export interface DocumentRow {
  id: string;
  file_name: string;
  storage_path: string;
  mime_type: string;
  file_size: number;
  cert_type: string;
  doc_category: DocCategoryType;
  version: number;
  supersedes: string | null;
  status: DocStatus;
  extracted_at: string | null;
  /** status='failed' 일 때 화면에 보여줄 사유 */
  failure_reason: string | null;
  chunk_count: number;
  /** 파일 내용 해시(SHA-256, 소문자 16진수). 같은 파일의 중복 업로드를 막는다. 이전에 올린 문서는 null 일 수 있다. */
  content_hash: string | null;
  /** narrative = 설명 자료(질문을 AI가 만든다), qa_pairs = 질문·답변이 정리된 자료(원문 그대로) */
  doc_format: DocFormat;
  /** qa_pairs 문서는 업로드 후 미리보기로 형식을 확인받아야 FAQ 초안을 만들 수 있다 */
  format_confirmed: boolean;
  /** 추출 품질 지표 (공백 제외 글자 수, 페이지/슬라이드 수) */
  extracted_chars: number | null;
  page_count: number | null;
  uploaded_by: string;
  created_at: string;
  updated_at: string;
}

/** 문서 단위 FAQ 일괄 초안 생성 작업 (Phase 12). 테이블 generation_jobs */
export type DocFaqJobStatus = "running" | "done" | "failed" | "canceled";

export interface DocFaqRejected {
  page: number | null;
  /** 탈락한 항목의 질문 또는 원문 일부 */
  content: string;
  reason: string;
  /** 어느 단계에서 탈락했는지: evidence | numbers | consulting | other_authority | duplicate | limit | error */
  stage: string;
  /** 중복으로 탈락했을 때 겹치는 기존 FAQ (관리자 화면에서 링크로 연결) */
  faq_id?: string;
}

export interface DocFaqJob {
  id: string;
  document_id: string;
  status: DocFaqJobStatus;
  total_chunks: number;
  /** 이미 처리한 청크(또는 Q&A 쌍) 수. 중단되면 여기서부터 이어서 한다 */
  done_chunks: number;
  created_count: number;
  replaced_count: number;
  protected_count: number;
  rejected: DocFaqRejected[];
  error: string | null;
  /** 파일당 상한(50건)에 도달해 중단됨 */
  limit_reached: boolean;
  started_by: string;
  started_at: string;
  updated_at: string;
  finished_at: string | null;
}
