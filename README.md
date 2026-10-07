# IGSC 고객 Q&A 시스템

국제지속가능인증원 고객 문의 응대 챗봇. 프로젝트 규칙은 [CLAUDE.md](CLAUDE.md) 참고.

스택: Next.js 15 (App Router) / TypeScript / Tailwind CSS / Supabase / Claude API / Vercel

## 로컬 실행

요구사항: Node.js 20+

```bash
npm install
cp .env.example .env.local   # 값 채우기
npm run dev
```

http://localhost:3000 에서 확인. 헬스체크:

```bash
curl http://localhost:3000/api/health
# {"ok":true,"status":"ok","db":true,"ai":true}
```

## 환경변수

전체 목록·설명은 [docs/deploy.md](docs/deploy.md), 샘플은 [.env.example](.env.example).

| 이름 | 용도 | 노출 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 프로젝트 URL | 브라우저 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon(publishable) key | 브라우저 |
| `SUPABASE_SERVICE_ROLE_KEY` | service role(secret) key | **서버 전용** |
| `ANTHROPIC_API_KEY` | Claude API | **서버 전용** |
| `ADMIN_ALLOWED_EMAILS` | 관리자 이메일(쉼표 구분) | **서버 전용** |
| `NEXT_PUBLIC_SITE_URL` | 서비스 공개 주소(로그인 링크 복귀) | 공개 |
| `CRON_SECRET` | 자동 점검(`/api/cron/monitor`) 인증 | **서버 전용** |
| `RESEND_API_KEY` · `ALERT_EMAIL_FROM` · `ALERT_WEBHOOK_URL` | 장애 알림(이메일·웹훅) | **서버 전용** |
| `RATE_*` | 요청 제한 조정(선택) | 서버 |
| `CLASSIFY_MODEL` · `SEARCH_MODEL` · `ANSWER_MODEL` · `DRAFT_MODEL` | 모델 교체(선택) | 서버 |

## 폴더 구조

- `app/` 페이지, `app/api/` API 라우트
- `lib/db/` DB 접근 (`client.ts` 브라우저용 anon, `server.ts` 서버용 service role — `server-only`로 클라이언트 import 시 빌드 실패)
- `lib/prompts/` 시스템 프롬프트 상수
- `lib/ingest/` FAQ 수집/적재
- `components/` UI 컴포넌트

## FAQ 수집·생성·적재 (Phase 2)

```bash
npm run ingest:crawl     # igsc.kr → data/raw/*.json (이미 받은 URL은 건너뜀)
npm run ingest:generate  # data/raw → data/faq-draft.json + data/faq-draft.csv (Claude API, 결과 캐시: data/cache/)
npm run ingest:load      # data/faq-draft.json → Supabase faq (upsert, 승인본은 덮어쓰지 않음)
```

- 생성된 FAQ는 전부 `status='draft'`. CSV로 검수한 뒤 승인(`approved`)해야 챗봇 답변에 쓰인다.
- 비용·기간은 원문에 없으면 `answer` 빈 값 + `needs_input=true` 로 남는다.
- 프롬프트를 바꿔 재생성하려면 `data/cache/` 를 지운다. 재생성하면 질문이 바뀌어 id가 달라지므로, 이미 적재한 초안은 DB에서 따로 정리해야 한다.

## 관리자 화면 (/admin)

FAQ 등록·승인, 미답변 질문 처리, 대화 로그, 대시보드. 이메일 매직링크로 로그인하며 `ADMIN_ALLOWED_EMAILS` 에 등록된 주소만 들어갈 수 있다.

**처음 설정 (한 번)**
1. Supabase 대시보드 → Authentication → URL Configuration
   - Site URL: 서비스 주소 (로컬은 `http://localhost:3000`)
   - Redirect URLs 에 `{서비스 주소}/admin/auth/callback` 추가 (로컬: `http://localhost:3000/admin/auth/callback`)
2. Authentication → Providers → Email 사용 설정 (기본값). 메일 발송 한도가 낮은 기본 SMTP 대신 운영에서는 자체 SMTP 를 연결하는 것을 권장한다.
3. `.env.local` 의 `ADMIN_ALLOWED_EMAILS` 에 관리자 이메일을 쉼표로 구분해 입력.

**로그인**: `/admin/login` → 이메일 입력 → 메일의 링크를 **요청한 같은 브라우저**에서 열기.
허용 목록에 없는 주소는 메일이 발송되지 않고, 화면에는 동일한 안내가 나온다.

**FAQ 저장**: 저장하면 챗봇 FAQ 캐시가 무효화되고, 다른 서버 인스턴스에도 다음 요청부터 반영된다 (재배포 불필요).
`담당자 입력 필요` 표시가 있거나 답변이 빈 FAQ는 승인할 수 없다.

## 문서

| 문서 | 내용 |
|---|---|
| [docs/system-overview.html](docs/system-overview.html) | **시스템 소개(개발자용)**: 구조·파이프라인·데이터·보안·운영 |
| [docs/handover/](docs/handover/) | **최종 인계 문서**: 운영자 매뉴얼, 시스템 설계서, 인수 매뉴얼(고객용), 인계 매뉴얼(개발 담당용) — `*_final` |
| [docs/deploy.md](docs/deploy.md) | 환경변수, Vercel/Supabase 설정, 배포 후 확인 |
| [docs/monitoring.md](docs/monitoring.md) | 운영 상태·알림 설정 |
| [docs/channels.md](docs/channels.md) | 유입 채널(링크 `?src=`) 관리 |
| [docs/golden-tests.md](docs/golden-tests.md) | 대표 질문 회귀 점검 |
| [docs/widget-install.md](docs/widget-install.md) | 홈페이지 위젯 삽입 가이드 |
| [scripts/README.md](scripts/README.md) | 운영 스크립트와 일회성 스크립트 구분 |
| [docs/manual.md](docs/manual.md) | (구버전) 이전 시스템 매뉴얼 — 최신은 `docs/handover/` 의 운영자 매뉴얼 |

점검: `npx tsc --noEmit` · `npx eslint .` · `npm test`(자동 테스트) · `npm run golden -- --safety`(안전 규칙 회귀) · `npm run smoke:deploy -- {주소}`(배포 확인)
