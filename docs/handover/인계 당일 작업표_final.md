# 인계 당일 작업표 — IGSC 인증 문의 챗봇 (2026-10-08)

**진행**: 개발 담당(나) · 고객 담당 함께 · 계정 로그인과 키 입력은 **고객이 직접**(비밀번호·키를 주고받지 않음) · 예상 소요 약 2시간 30분

**사전 상태 (10/7 확인):** 승인 FAQ 0건 · 인증 이력 비공개 · 대화·미답변 0건 · 코드 GitHub 반영(`jonghunkim84-design/IGSC-chatbot`, 비공개) · Supabase 새 키 호환 검증 완료 · 마이그레이션 0001~0012 적용

| # | 작업 | 상세 (명령·메뉴) | 확인 기준 | 누가 | ✔ |
|---|---|---|---|---|---|
| 0 | **시작 전 점검** (5분) | 고객 준비물(아래 표) 확인 · 운영 상태 정상 · 승인 0건·대화 0건 확인 | 준비물 모두 있음 | 함께 | ☐ |
| 1 | **백업** (5분) | `npx tsx scripts/export-backup.ts` | manifest: faq 489 · documents 26 · 파일 26 | 개발 | ☐ |
| 2 | **Supabase 프로젝트 이전** (15분) | 개발 계정 프로젝트 → Project Settings → General → **Transfer project** → 고객 조직 선택 (개발 담당은 고객 조직에 관리자/소유자로 초대돼 있어야 함) | 고객 조직에 프로젝트 보임 · 테이블 행 수·파일 26개 일치 · 주소 동일 | 개발 | ☐ |
| 3 | **코드 전달** (10분) | `gh api -X PUT repos/jonghunkim84-design/IGSC-chatbot/collaborators/<고객ID> -f permission=pull` → 고객 초대 수락 → `git clone` → 고객 저장소에 `git push` (인수 매뉴얼 4-6) | 고객 저장소에 전체 이력 · `.env`·`data`·`customer-files` 없음 | 고객(개발 안내) | ☐ |
| 4 | **고객 Supabase 키 생성** (5분) | 이전된 프로젝트 → Settings → **API Keys** → secret 키 + publishable 키 **고객이 직접 생성** (개발 키 사용 안 함) | 키 2개 확보(화면·파일 공유 금지) | 고객 | ☐ |
| 5 | **고객 Vercel 새 배포** (30분) | 고객이 `vercel login` → `vercel link`(새 프로젝트) → **환경 변수 입력**(아래) → Functions Region = Supabase 지역 → `vercel deploy --prod` (Pro면 `vercel.json` 크론을 `*/30 * * * *`로) | 배포 완료, 배포 주소로 `/chat` 열림 | 고객(개발 안내) | ☐ |
| 6 | **도메인·로그인 설정** (20분) | Vercel → Domains 추가 → 고객 DNS 담당이 레코드 입력 → `NEXT_PUBLIC_SITE_URL` 설정 → Supabase **Authentication → URL Configuration**(Site URL, Redirect URLs `{주소}/admin/auth/callback`) · SMTP 권장 → 재배포 | 정식 주소로 접속 · 로그인 링크가 정식 주소로 돌아옴 | 고객 + 개발 | ☐ |
| 7 | **알림 메일·관리자** (15분) | 고객 Resend: API 키 + 도메인 인증 → `ALERT_EMAIL_FROM` · `RESEND_API_KEY` · **`ADMIN_ALLOWED_EMAILS` = 실제 관리자 3명**(개발자 이메일 제외) → 재배포 | 관리자 3명 모두 로그인 메일 수신·로그인 | 고객 | ☐ |
| 8 | **정상 동작 점검** (20분) | `npm run smoke:deploy -- https://<주소>` · `npm run golden -- --safety` · 수동: 화면 7개(대시보드·FAQ·미답변·로그·유입 채널·인증 종류·운영 상태) · 문서 파일 내려받기 · 챗봇 "AI 답변 준비 중" · **운영 상태 = 정상(승인 0건 '주의'는 정상)** · 유입 채널 링크가 새 주소로 만들어짐 | 모두 통과 | 함께 | ☐ |
| 9 | **점검 기록 정리** (3분) | `npx tsx scripts/delete-chat-log.ts --all --apply` · `npx tsx scripts/delete-unanswered-before.ts <내일날짜> --apply` | 대화·미답변 0건 | 개발 | ☐ |
| 10 | **키 폐기** (10분) | 고객 키로 정상 확인 후: 개발용 Supabase 키(`.env.keytest`의 secret 포함)·기존 anon/service_role **비활성화**, Anthropic·Resend 개발 키 폐기 → **재확인(8번 일부)** | 비활성화 후에도 챗봇·로그인 정상 | 개발 + 고객 | ☐ |
| 11 | **정리·권한 회수** (10분) | 고객 collaborator 제거 · `IGSC-chatbot`(내 저장소) 삭제/보관 결정 · 개발 PC `.env.local`·`.env.keytest` 삭제·`git remote remove origin`·`vercel logout` · 개발 Vercel 프로젝트 삭제 · **Supabase 조직에서 내 권한 제거** | 개발 계정에 운영 접근 없음 | 개발 + 고객 | ☐ |
| 12 | **인수 확인서 서명** (5분) | 인수 매뉴얼 6-4 확인서 · 백업 파일 보관/삭제 합의 · 지원 범위·응답 시간 합의 | 양쪽 서명 | 함께 | ☐ |

**고객 준비물 (0번 확인):** Vercel **Pro** 계정 · Supabase 조직(**Pro**)+개발 담당 초대 · Anthropic 크레딧·월 한도 · Resend 계정 · GitHub 계정(ID) · **정식 도메인·DNS 담당자** · 관리자 이메일 3개 · 결제 수단

**5번 환경 변수 (Vercel → Production):** `NEXT_PUBLIC_SUPABASE_URL`(이전 후에도 동일) · `NEXT_PUBLIC_SUPABASE_ANON_KEY`(고객 publishable) · `SUPABASE_SERVICE_ROLE_KEY`(고객 secret) · `ANTHROPIC_API_KEY`(고객 키) · `ADMIN_ALLOWED_EMAILS`(7번) · `NEXT_PUBLIC_SITE_URL`(6번) · `CRON_SECRET`(새 임의 문자열) · `RESEND_API_KEY` · `ALERT_EMAIL_FROM` · `CHAT_FRAME_ANCESTORS`(홈페이지 주소). **설정하지 않음:** `SEARCH_DEBUG_ENABLED`

**현장에서 고객에게 받을 답변:** Microplastic-free 금액(250만/300만원) · 비건 해외용 소요기간 · ISO별 금액표(9001 외) · Caffeine Free 인증 종류 등록 · 대화 로그 보관 기준 · 담당자 연락처 맞는지 → 답변 후 해당 비용·기간 FAQ **초안 확인·승인은 고객이** 합니다.

**인계 후 안내:** 채널 링크(블로그·링크드인·인스타그램·이메일 서명)는 **정식 도메인 확정 후** 관리자 화면 *유입 채널*에서 복사해 걸기 · FAQ 승인은 고객이 시작(승인 전 챗봇은 "AI 답변 준비 중") · 문제 발생 시 운영자 매뉴얼 8장·운영 상태 화면 · 자세한 절차는 *인계 매뉴얼(B장)*, *인수 매뉴얼*, *운영자 매뉴얼*
