# scripts/ 안내

운영에 계속 쓰는 것과, 개발 중 한 번 쓴 일회성 스크립트를 구분합니다. 모두 `.env.local` 의 키를 사용하고, **운영 DB를 바꾸는 스크립트는 기본이 미리보기이며 `--apply` 를 붙여야 실행**됩니다(실행 전 `data/backup/` 에 백업 저장).

## 운영용 (계속 사용)

| 스크립트 | 용도 | 실행 |
|---|---|---|
| `export-backup.ts` | 전체 백업(전 테이블 + 문서 파일, 읽기 전용) | `npx tsx scripts/export-backup.ts` |
| `reset-faq-approval.ts` | 승인 FAQ를 초안으로 되돌리기 / 백업에서 복원 | `npx tsx scripts/reset-faq-approval.ts [--apply]` |
| `delete-chat-log.ts` | 대화 기록 삭제(백업 후) | `npx tsx scripts/delete-chat-log.ts --all [--apply]` |
| `delete-unanswered-before.ts` | 미답변 질문 삭제(백업 후) | `npx tsx scripts/delete-unanswered-before.ts YYYY-MM-DD [--apply]` |
| `smoke-deploy.ts` | 배포 후 자동 점검 | `npm run smoke:deploy -- <주소>` |
| `golden.ts` | 대표 질문 회귀 점검(`--safety`: FAQ 없이도 통과해야 함) | `npm run golden [-- --safety]` |
| `backfill-content-hash.ts` | 문서 해시 채우기 | 마이그레이션 0010 직후 1회 |
| 인증 이력 공개 전환 | `npm run ingest:history:public -- on\|off` | (`lib/ingest/toggle-history.ts`) |

## 개발 검증용 (필요할 때만)

`verify-*.ts`, `chat-smoke.ts`, `check-cert-names.ts` — `package.json` 의 `verify:*`, `smoke:chat`, `cert-names:check` 로 실행. 실제 Claude·DB를 호출하는 점검용입니다.

## 일회성 (개발 중 데이터 적재·분석 — 다시 쓸 일 거의 없음)

| 스크립트 | 무엇을 했나 |
|---|---|
| `load-docx-faq.ts`, `compare-docx-faq.ts` | 고객 FAQ 문서(docx) 적재·기존 FAQ와 비교 |
| `draft-required-docs.ts`, `load-required-docs.ts` | 필요서류 PDF → FAQ 초안 |
| `draft-doc-faqs.ts`, `load-doc-faqs.ts`, `draft-pptx-faqs.ts` | 절차·소개자료 → FAQ 초안 |
| `create-overview-faq.ts`, `move-faq-source.ts` | 개요 FAQ 생성, 출처 이동 |
| `analyze-inquiries.ts` | 문의 이력 분석 |
| `load-cost-duration-faqs.ts`, `update-cost-duration-faqs.ts` | 고객이 준 비용·기간(2026-10-07)을 FAQ 초안으로 반영 (이후 변경은 관리자 화면에서) |

> 일회성 스크립트는 당시 고객 자료·DB 상태를 전제로 하므로 다시 실행하기 전에 내용을 확인하세요. 새 작업은 관리자 화면(문서 보관함 → FAQ 초안 만들기)으로 하는 것이 원칙입니다.
