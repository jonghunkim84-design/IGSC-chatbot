/**
 * 문서 수집·초안 생성 설정값 (임계값·상한을 한곳에서 관리한다).
 * 값을 바꾸면 문서 보관함 업로드 추출(Phase 9)과 문서 단위 FAQ 일괄 초안(Phase 12)에 모두 반영된다.
 */

/**
 * PDF 추출 품질 기준: 페이지당 평균 글자 수(공백 제외)가 이 값 미만이면 스캔 문서로 보고 추출 실패(status='failed')로 처리한다.
 * 그 외 형식(DOCX·XLSX·PPTX·CSV·TXT·MD)은 실패 처리하지 않고, 파일 크기 대비 추출 글자 수를 지표로만 기록한다.
 */
export const PDF_MIN_CHARS_PER_PAGE = 50;

/** PDF 스캔 문서로 판정되어 추출이 실패했을 때 화면에 보여주는 사유 */
export const MSG_PDF_SCANNED = "텍스트가 거의 추출되지 않았습니다. 스캔 문서로 보입니다. 텍스트가 있는 원본 파일을 올려 주세요";

/** 한 요청(Vercel 60초 제한)에서 처리하는 청크 수. 진행 상태는 generation_jobs 에 저장되고 중단되면 done_chunks 부터 이어서 한다. */
export const CHUNKS_PER_REQUEST = 5;

/** 질문·답변 쌍 문서는 한 요청에서 이 개수만큼의 쌍을 처리한다 (쌍마다 중복 검사 호출이 있어 청크보다 가볍지 않다) */
export const QA_PAIRS_PER_REQUEST = 10;

/** 청크 하나에서 뽑는 FAQ 후보 최대 건수 */
export const MAX_FAQ_PER_CHUNK = 3;

/** 문서 한 건에서 만드는 FAQ 후보 상한. 도달하면 중단하고 "상한 도달, 분할 업로드 권장"을 안내한다. */
export const MAX_DRAFTS_PER_DOCUMENT = 50;

/** 상한에 도달했을 때 화면에 보여주는 안내 */
export const MSG_LIMIT_REACHED = `상한(${MAX_DRAFTS_PER_DOCUMENT}건)에 도달해 중단했습니다. 문서를 나누어 올리는 것을 권장합니다.`;

/** 질문·답변 쌍 문서의 업로드 후 형식 확인 미리보기 건수 */
export const QA_PREVIEW_COUNT = 3;
