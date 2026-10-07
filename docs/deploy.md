# 배포 가이드 (Vercel)

## 1. 환경변수

Vercel → 프로젝트 → Settings → Environment Variables. **Production**(필요하면 Preview 도)에 등록합니다.
샘플은 [.env.example](../.env.example).

| 이름 | 필수 | 공개 여부 | 설명 |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | 브라우저 노출 | `https://xxxx.supabase.co` — 끝에 `/rest/v1/` 등을 붙이지 말 것 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | 브라우저 노출 | anon (public) key |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | **서버 전용** | service role key. `NEXT_PUBLIC_` 를 붙이면 안 됨 |
| `ANTHROPIC_API_KEY` | ✅ | **서버 전용** | Claude API 키 (`sk-ant-…`) |
| `ADMIN_ALLOWED_EMAILS` | ✅ | 서버 전용 | 관리자 이메일, 쉼표 구분 |
| `NEXT_PUBLIC_SITE_URL` | 권장 | 공개 | 서비스 공개 주소(예: `https://chat.example.com`). 관리자 로그인 링크의 돌아올 주소 |
| `CHAT_FRAME_ANCESTORS` | 권장 | 서버 | `/chat` 을 iframe 으로 열 수 있는 사이트(공백 구분). 비우면 모든 사이트 허용 |
| `CLASSIFY_MODEL` / `SEARCH_MODEL` / `ANSWER_MODEL` | 선택 | 서버 | 모델 교체. 기본: 분류·선택 Haiku 4.5, 답변 `claude-sonnet-5-5` |
| `SEARCH_DEBUG_ENABLED` | ❌ | — | 개발용 `/api/search` 를 여는 스위치. **운영에서는 설정하지 않음** |

> 서비스 키는 코드/채팅/문서에 붙여 넣지 말고 Vercel 환경변수 화면에만 입력하세요.
> 로컬 `.env.local` 은 배포에 포함되지 않습니다(`.vercelignore`, `.gitignore`).

## 2. 배포 전 Supabase 설정 (한 번)

1. **마이그레이션**: `supabase/migrations/0001_init.sql`, `0002_chat_log_routes.sql` 이 SQL Editor 에서 실행되어 있어야 함. 이후 기능에 따라 `0003`~`0011` 이 순서대로 적용되어 있어야 한다 (0011 은 요청 제한, 아래 "요청 제한" 절). 문서 단위 FAQ 일괄 초안(문서 보관함의 [FAQ 초안 만들기])은 `0007_doc_faq_jobs.sql`, 문서 검수 큐의 [보류]는 `0008_faq_review_hold.sql`, 관리자 화면의 인증 종류 관리(/admin/cert-types)는 `0009_cert_types.sql`(기존 인증 종류 51건이 초기 데이터로 들어간다)이 필요하다. `0010_generation_jobs_and_more.sql` 은 작업 테이블 이름 변경(doc_faq_jobs → generation_jobs)과 중복 업로드 해시·문서 형식·승인자 기록 컬럼을 추가한다. **0010 은 코드 배포와 함께 적용한다** (적용하면 이전 배포의 FAQ 일괄 초안 기능이 새 코드가 배포되기 전까지 동작하지 않는다). 적용 후 `npx tsx scripts/backfill-content-hash.ts --apply` 로 기존 문서의 해시를 채운다.
2. **Authentication → URL Configuration**
   - Site URL: 서비스 공개 주소
   - Redirect URLs: `{서비스 주소}/admin/auth/callback` (로컬 개발용 `http://localhost:3000/admin/auth/callback` 도 함께 두어도 됨)
3. 운영에서는 **Authentication → SMTP** 에 자체 SMTP 연결 권장 (기본 메일은 시간당 발송 한도가 낮음)

## 3. Vercel 설정

- Framework: Next.js (자동 감지). Build: `npm run build`, Install: `npm install` (기본값)
- Node.js: 20 이상
- **Functions Region**: Supabase 프로젝트와 같은 지역으로 (Settings → Functions → Function Region). 응답 지연이 줄어듭니다.
- `/api/chat` 은 답변을 스트리밍하며 최대 60초로 설정되어 있습니다(`maxDuration`). 공식 문서(2026-10 확인) 기준 함수 최대 실행 시간은 Hobby 300초, Pro 기본 300초라서 60초 설정은 두 플랜 모두 허용됩니다. 다만 Hobby는 **비상업·개인용만 허용**되고 크론이 하루 1회로 제한되므로 실제 서비스는 Pro를 사용합니다.
- 코드가 자동으로 하는 운영 보호: 루트 `/` → `/chat` 이동, `/api/search`·`/widget-test.html` 은 404, `/admin` 은 프레임 삽입 차단.

## 4. 배포 방법

**A. Git 연동 (권장)** — 저장소를 GitHub 등에 올리고 Vercel 에서 Import → 환경변수 입력 → Deploy.

**B. CLI**
```bash
vercel            # 프로젝트 연결(최초 1회) 후 Preview 배포
vercel --prod     # 운영 배포
```
환경변수는 대시보드 또는 `vercel env add NAME production` 으로 등록합니다.

## 5. 배포 후 확인

```bash
npm run smoke:deploy -- https://{배포 주소}
```
헬스체크(DB 연결), `/chat`·`/widget.js`, 관리자 보호(로그인 없이 접근 차단), 개발용 경로 404, 챗봇 API(컨설팅 차단·이의제기·무관·영어·FAQ 없음) 를 자동 확인합니다. (테스트 질문 몇 건이 대화 로그에 남습니다.)

수동 확인 (5분):
- [ ] `{주소}/chat` 에서 추천 질문 클릭 → 답변/되묻기 버튼 동작
- [ ] `{주소}/admin/login` 에서 로그인 → 대시보드·FAQ·미답변·로그 화면
- [ ] FAQ 수정 후 챗봇 답변에 바로 반영
- [ ] 고객사(테스트) 페이지에 `<script src="{주소}/widget.js" async></script>` 삽입 → 우측 하단 버튼, 모바일 전체 화면
- [ ] 위 확인 후 [docs/widget-install.md](widget-install.md) 의 `{챗봇 도메인}` 을 실제 주소로 바꿔 외주 업체에 전달

## 6. 운영 참고

- 요청 제한(rate limit)은 적용되어 있다. 아래 "요청 제한" 절과 `docs/monitoring.md`(운영 상태·알림) 참고.
- 비용: 챗봇 질문 1건당 Claude 호출이 분류 1회 + FAQ 선택 1~2회 + 답변 생성 1회 발생한다. AI 크레딧이 소진되면 챗봇이 모든 질문을 담당자 이관으로 처리하므로 월 지출 한도와 자동 충전(Console의 Settings > Billing)을 설정한다. 지출 한도에 닿아도 챗봇이 멈춘다.
- 백업: `npx tsx scripts/export-backup.ts` (전 테이블 + 문서 파일, `data/backup/full-<시각>/`). 프로젝트 이전·키 재발급·대량 삭제 전에 실행한다.
- 자동 점검: `vercel.json` 의 크론(`/api/cron/monitor`)은 Hobby 요금제에서 하루 1회만 허용된다. Pro 는 `*/30 * * * *` 로 바꿀 수 있다.

## 7. 현재 배포 상태

- 운영 주소: https://igsc-chatbot.vercel.app (개발 계정의 Vercel 프로젝트 `igsc-chatbot`). 고객 인계 시 고객 계정으로 새로 배포한다 (`docs/education/` 의 인계·인수 매뉴얼 참고).
- 마이그레이션 0001~0011 적용 완료. 0012(`chat_log.source` — 유입 채널 기록, `docs/channels.md`)는 SQL Editor 에서 실행해야 채널 집계가 시작된다.
- 환경변수: 필수 5개 + `CRON_SECRET`, `RESEND_API_KEY` 등록 (서버 전용 키는 민감 변수로 저장).

## 요청 제한 (마이그레이션 0011)
- `supabase/migrations/0011_rate_limits.sql` 을 Supabase SQL Editor 에서 실행한 뒤 배포한다. (실행 전에 배포하면 DB 제한은 오류로 기록되고 인스턴스 메모리 제한으로 대체된다.)
- 기본 한도: 채팅 한 IP 당 분당 15 / 시간당 120, 전체 하루 3000건. 관리자 로그인 메일 요청 IP 당 10 / 이메일 당 5 (시간당).
- 한도 변경은 환경 변수(`RATE_CHAT_PER_MINUTE` 등, `.env.example` 참고)로 한다. 회사 사무실처럼 한 IP 를 여러 명이 쓰는 환경이면 시간당 값을 올린다.
- 한도를 넘으면 챗봇은 "잠시 후 다시 시도" 안내와 담당자 연락처를 보여주고(HTTP 429), 로그에 `요청 제한 초과` 가 남는다.
