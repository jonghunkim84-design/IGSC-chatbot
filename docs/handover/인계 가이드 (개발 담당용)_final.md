# IGSC 인증 문의 챗봇 — 시스템 인계 가이드 (개발 담당용)

고객에게 시스템을 넘기는 **개발 담당자**가 인계 전에 준비할 일과 인계 당일 작업 방법을 정리한 문서입니다. 고객용 안내는 「인수 매뉴얼 (고객용, final)」에 있습니다. 두 문서의 단계 번호는 서로 맞춰져 있습니다.

> 최종판(final) · 기준일 2026-10-07 · 상세 항목 목록은 `docs/handover-checklist.md`, 환경 변수와 배포는 `docs/deploy.md`, 운영 모니터링은 `docs/monitoring.md`

> **외부 서비스 정보의 기준**: Vercel, Supabase, Claude Code, Anthropic의 요금·제한·이전 조건은 **2026-10-04에 공식 문서를 확인**해 반영했습니다 (출처는 부록 E). 인계 당일 직전에 한 번 더 확인하세요.

## 0. 한눈에 보기

| 단계 | 시기 | 핵심 |
|---|---|---|
| **A. 인계 전 준비** | 인계일 2주~1주 전 | 코드·문서 정리, 소스 저장소 준비, 남은 기능 수정, 검증 |
| **B. 인계 당일** | 인계일 (2~3시간) | 백업 → Supabase 이전 → 고객 Vercel에 새 배포 → 점검 → 키 재발급 → 권한 회수 |
| **C. 인계 후** | 인계 직후 | 인수 확인서, 지원 합의, 알려진 한계 전달 |

### 인계 방식 (결정 사항)
- **Supabase**: 프로젝트를 고객 조직으로 **이전**합니다. (데이터·파일·주소·키가 그대로 유지됩니다. 새로 만들어 옮기는 방법은 부록 C.)
- **Vercel**: 현재 프로젝트는 개발 계정(`jonghun-kim-s-projects`) 소유이므로, **고객 계정에 새 프로젝트로 배포**합니다. 이전 기능은 쓰지 않습니다.
- **키**: 새 서버가 정상 동작하는 것을 확인한 **뒤에** 재발급합니다. (먼저 바꾸면 되돌릴 방법이 줄어듭니다.)
- **운영 주체**: 고객이 Claude Code로 직접 운영합니다. 그래서 규칙과 문서가 저장소 안에 있어야 합니다(A-1, A-3).

### 가장 큰 위험 5가지
1. **주소 변경**: 현재 `igsc-chatbot.vercel.app`은 개발 계정 프로젝트의 주소라 고객 계정에서 쓸 수 없습니다 → **정식 도메인을 먼저 정하고 그 주소로 위젯을 삽입**하게 합니다.
2. **AI 크레딧 소진**: 챗봇이 모든 질문을 담당자 이관으로 처리합니다(개발 중 실제로 발생) → Billing의 월 지출 한도·자동 충전 설정 (한도에 닿아도 챗봇이 멈춤).
3. **키 노출**: 개발 중 쓴 키가 대화·로그에 남아 있습니다 → 인계 후 전부 폐기·재발급.
4. **개인정보**: 로컬의 `docs/customer-files/`, `data/`, 백업에 고객 문의 원문이 있습니다 → 저장소에 올리지 않고 보관 방법을 합의.
5. **무료 요금제**: Vercel Hobby는 비상업·개인용만 허용되고 크론이 하루 1회로 제한됩니다(Pro는 1분 간격). Supabase 무료 프로젝트는 1주 비활성이면 일시 정지됩니다 → 고객은 두 서비스 모두 Pro.
6. **Supabase 기존 키 폐지 예정**: 공식 문서상 기존 `anon`/`service_role` 키는 2026년 말까지 단계적으로 폐지되고 새 키(`sb_publishable_…`, `sb_secret_…`)로 전환됩니다. 이 시스템은 기존 키 이름(`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`)을 쓰므로 **인계 전에 새 키로 동작하는지 검증**해야 합니다 (A-4).

---

## A. 인계 전 준비

### A-1. 소스 코드 저장소
현재 프로젝트는 **git 저장소가 아닙니다.** 고객 소유 저장소로 올릴 준비를 합니다.

1. **`.gitignore` 보강** (이미 반영됨): 비밀 정보와 개인정보가 저장소에 올라가지 않게 합니다.
   - `.env*` (단 `.env.example`은 제외) — 이미 있음
   - `/data/` — 로컬 백업·분석 결과(고객 질문 원문 포함)
   - `/docs/customer-files/` — 고객이 보낸 원본 파일(이름·연락처 포함)
   - `.scratch*`, `*.tsbuildinfo`
2. **저장소에 올리기 전 비밀 정보 점검**: 아래를 검색해 키가 코드·문서에 없는지 확인합니다.
```
git init
git add -A
git status          # 올라갈 파일 목록 확인 (data/, customer-files, .env.local 이 없어야 함)
```
   소스에서 `sk-ant-`, `re_`, `eyJ`(Supabase 키 형태), 이메일 주소 등을 검색합니다. **대화·문서에 붙여 넣은 키는 인계 후 재발급하므로 지금 노출돼 있어도 무방**하지만, 소스 파일에는 없어야 합니다.
3. **고객이 만든 비공개 저장소**에 개발 담당자가 초대받아 첫 커밋을 올립니다 (`git remote add origin …`, `git push`). 인계 후에는 고객이 소유합니다.
4. **브랜치 규칙**: `main` 하나만 쓰고, 변경은 Claude Code가 커밋하도록 안내합니다.

### A-2. 코드 정리
| 작업 | 상태 |
|---|---|
| 임시 파일 삭제: `.scratch-e.cjs` 등 `.scratch*` | 미완 |
| 일회성 스크립트 정리 (`scripts/` 약 28개): 운영에 계속 쓰는 것과 개발용을 구분해 `scripts/README.md`에 목록화, 개발용은 `scripts/dev-oneoff/`로 이동 | 미완 |
| lint 오류 4건 (오래된 일회성 스크립트) 정리 | 미완 |
| `docs/dev-approved.md` (개발용 임시 승인 기록, 옛 내용): 삭제 | 미완 |
| `README.md` 환경 변수 표 갱신 (`CRON_SECRET`, `RESEND_API_KEY` 등 추가) | 미완 |
| `docs/manual.md` (9월 30일 기준) 최신화 또는 교육 매뉴얼로 대체 | 미완 |
| `npm audit`: next/postcss 취약점 2건(해결에는 Next 16 업그레이드 필요) — 기록만 남기고 인계 | 미완 |

### A-3. Claude Code 운영 규칙 (`CLAUDE.md` 보강)
고객의 Claude Code는 **`CLAUDE.md`를 읽고 일합니다.** 이 파일에 아래 운영 규칙이 있어야 합니다 (현재는 개발 규칙만 있음).

```
## 운영 규칙 (고객 인계 후)
- FAQ 승인(status='approved')은 사람이 관리자 화면에서만 한다. 스크립트·코드로 대량 승인하지 않는다.
- 운영 DB를 바꾸는 작업(삭제·승인 초기화·키 교체) 전에는 `npx tsx scripts/export-backup.ts` 로 백업한다.
- 삭제·초기화 스크립트는 미리보기(기본)를 먼저 보여주고 사용자 확인 후 `--apply` 로 실행한다.
- 키·비밀번호를 출력하거나 대화에 남기지 않는다. 키는 환경 변수 또는 .env.local 에만 둔다.
- 배포 후 `npm run smoke:deploy -- <주소>` 와 `npm run golden -- --safety` 를 실행한다.
```
> 이 파일은 개발 담당자가 수정하면 안 되는 고객 규칙이 아니라, **인계 후 고객 운영을 안전하게 하는 장치**입니다. 고객과 내용을 합의하고 반영하세요.

> **대화 기억은 넘어가지 않습니다.** 개발 중 Claude Code가 쌓은 개인 메모리(`~/.claude/projects/…/memory`)는 이 PC에만 있고 고객 PC로 가지 않습니다. 필요한 사실은 `CLAUDE.md`·`docs/`에 남아 있어야 합니다. (예: 승인은 사람만, 인계 시 승인 0건)

### A-4. 기능·데이터 상태 (인계 전 확인)
| 항목 | 상태 | 내용 |
|---|---|---|
| 승인 FAQ 0건일 때 안내 | ✅ 완료 | 승인 0건이면 인증 문의에 "AI 답변 준비 중입니다."(기록 안내·연락처 포함). 컨설팅·불만·범위 밖은 기존 고정 문구 |
| 유입 채널 기능 | ✅ 완료 (마이그레이션 0012 적용) | `chat_log.source`·`source_detail`, 관리자 **유입 채널** 메뉴, 위젯 `data-src`. 설명은 `docs/channels.md`, 고객 안내는 인수 가이드 9장 |
| 비용·기간 FAQ | ✅ 초안 17건 등록 | 고객 제공(2026-10-07) 값. **승인은 고객이 함**. 미확정: "기본" 인증의 범위, 부가세·기준일, 미세플라스틱 인증의 인증 종류 |
| 인증 이력 비공개 전환 | ✅ 완료(2026-10-07) | 220건 모두 비공개(공개 0건). 공개 동의 확인 후 `npm run ingest:history:public -- on` |
| 승인 FAQ 상태 정리 | ✅ 0건(2026-10-07) | 승인 443건을 초안으로 되돌림(복원 파일: `data/backup/faq-approved-2026-10-07T07-20-16.json`, 복원은 `reset-faq-approval.ts --restore`). 대화 기록·미답변도 0건으로 정리. **인계 당일 시작 전에 다시 확인** |
| 알림 메일 도메인 인증 | ⬜ 고객 도메인 확정 후 | 현재 테스트 발신 주소 |
| **Supabase 새 API 키(publishable/secret) 호환 검증** | ⬜ 미실행 | 기존 키 폐지 예정. 새 키를 만들어(Settings > API Keys) 로컬 `.env.local`에서 `NEXT_PUBLIC_SUPABASE_ANON_KEY`에 publishable 키, `SUPABASE_SERVICE_ROLE_KEY`에 secret 키를 넣고 `npm run dev`로 챗봇·관리자 로그인(`@supabase/ssr` 포함)·문서 업로드·백업 스크립트가 모두 동작하는지 확인. 동작하면 인계 시 새 키로 배포하고, 안 되면 코드 수정 후 인계 |

### A-5. 인계 전 검증 (모두 통과해야 합니다)
```
npx tsc --noEmit
npx eslint app lib components tests
npx vitest run
npm run build
npm run golden -- --safety     # FAQ가 없어도 통과해야 하는 안전 규칙
```
- 마이그레이션 `0001`~`0012` 적용 상태 확인(Supabase SQL Editor).
- 운영 상태 화면: DB·AI 정상.
- 테스트로 생긴 기록 확인: 대화 기록 0건, 미답변 0건, 승인 FAQ 0건 (인계 직전에 다시 확인하고 시연·검증으로 생긴 기록은 정리).

### A-6. 문서 묶음
고객에게 전달할 최종 문서:

| 문서 | 파일 |
|---|---|
| **운영자 매뉴얼 (final)** — 고객 운영 담당자용 | `docs/handover/IGSC 챗봇 운영자 매뉴얼_final.pdf` |
| 사용자 교육 자료 (PDF, PPTX) | `docs/education/` (교육용. 운영자 매뉴얼이 최신) |
| 고객 확인·결정 사항 | `docs/education/IGSC 챗봇 고객 확인 사항.pdf` |
| **인수 매뉴얼 (고객용, final)** — 계정·설치·인수일 절차·**채널 링크 연결(9장)** | `docs/handover/IGSC 챗봇 인수 매뉴얼 (고객용)_final.pdf` |
| 배포·운영 문서 | `docs/deploy.md`, `docs/monitoring.md`, `docs/golden-tests.md`, `docs/widget-install.md` |
| 인계 체크리스트 | `docs/handover-checklist.md` |

내부용 문서(이 인계 가이드, 분석 자료)는 고객에게 줄지 선택합니다.

### A-7. 고객 사전 확인 (인계일 1주 전까지)
고객이 「인수 가이드」 2장의 준비를 끝냈는지 확인합니다.
- [ ] Vercel Pro 계정(좌석 1명당 월 $20), Supabase 조직(Pro) + **개발 담당자를 관리자(Administrator) 또는 소유자(Owner)로 초대** (조직 전체 역할, 프로젝트 단위 역할은 이전을 막음)
- [ ] Anthropic Console 계정·크레딧, Resend 계정, GitHub 계정
- [ ] 정식 도메인 결정과 DNS 담당자 대기
- [ ] 관리자 이메일 3개, 알림 수신자
- [ ] 고객 PC 설치 완료(Node.js, Git, Claude Code, Vercel CLI)
- [ ] 인계일 일정과 짧은 중단 허용 합의

---

## B. 인계 당일

> **원칙**: 고객 계정의 비밀번호를 받지 않습니다. 로그인이 필요하면 **고객이 직접 로그인**하고(화면 공유), 개발 담당자는 안내합니다. 고객 PC에서 작업하는 것을 권장합니다.

### B-1. 시작 전 점검
- [ ] 고객 계정 확인 (A-7)
- [ ] 현재 운영 상태 정상 (운영 상태 화면)
- [ ] **FAQ 승인 상태 확인**: 원칙은 0건. 개발·시연 중 승인분이 남아 있으면 B-2 백업 뒤에 `npx tsx scripts/reset-faq-approval.ts`(미리보기) → `--apply`. 고객이 이미 승인한 FAQ는 보존(되돌리지 않음)
- [ ] **인증 이력 비공개** 확인 (`npm run ingest:history:public -- off`) — 공개 동의가 확인된 경우에만 공개
- [ ] 개발·시연 중 생긴 **대화 기록·미답변** 정리 (`scripts/delete-chat-log.ts`, `scripts/delete-unanswered-before.ts`, 미리보기 후 `--apply`)

### B-2. 백업 (되돌릴 수 있게)
```
npx tsx scripts/export-backup.ts
```
`data/backup/full-<시각>/` 에 모든 테이블과 문서 파일, `manifest.json`(건수 요약)이 저장됩니다. **manifest의 건수를 눈으로 확인**합니다(예: documents 26, 파일 26개. FAQ·대화 건수는 인계 시점 값). 백업 폴더는 고객에게 암호화된 매체로 전달하거나 안전한 저장소에 보관하고, 개발 PC에서는 인계 후 삭제합니다.

### B-3. Supabase 프로젝트 이전
1. **이전 조건 확인** (공식 문서 기준): 이전은 **원래 조직의 소유자**(개발 담당자)가 시작하고, **고객 조직에서는 멤버 이상**이어야 합니다. 공식 문서는 어느 역할이 "멤버 이상"인지 명확히 적지 않았으므로, **관리자 또는 소유자**로 초대받고 **조직 전체 역할**이어야 합니다(초대는 고객이 조직의 Team 설정에서 이메일로 보내며 **24시간 안에 수락**해야 함). 아래가 켜져 있으면 이전이 막힙니다: GitHub 연동, 프로젝트 단위 역할, 로그 드레인. **지역(리전)이 다른 조직으로는 이전할 수 없습니다.** 무료 요금제로 이전하면 1~2분 중단이 생길 수 있으니 고객 조직은 Pro여야 합니다. 비용은 이전이 끝날 때까지 원래 조직이, 이후 다음 청구 주기부터 고객 조직이 부담합니다.
2. 개발 계정의 Supabase 프로젝트 → 프로젝트 설정의 **General**에서 이전(Transfer project)을 시작하고 고객 조직을 선택 → 확인. (화면 이름은 바뀔 수 있습니다.)
3. 이전 후 확인:
   - [ ] 고객 조직에서 프로젝트가 보인다. 테이블(`faq`, `documents` 등) 행 수가 백업 manifest와 같다.
   - [ ] Storage의 `documents` 버킷 파일 수가 같다 (26개).
   - [ ] 프로젝트 주소(`NEXT_PUBLIC_SUPABASE_URL`)와 키가 그대로다. (이 단계에서는 키를 바꾸지 않습니다.)
4. **Authentication 설정** (이전 후 고객 도메인 기준):
   - Authentication → URL Configuration: **Site URL** = 새 챗봇 주소, **Redirect URLs** = `{새 주소}/admin/auth/callback`
   - Authentication → SMTP: 고객 메일 서비스로 설정 (기본 메일은 발송 한도가 낮음)
   - 기존 관리자 계정(개발자 이메일)은 `auth.users`에 남아 있으나 `ADMIN_ALLOWED_EMAILS`에서 빠지면 접근할 수 없습니다.

### B-4. 고객 Vercel에 새 프로젝트 배포
고객 PC의 프로젝트 폴더에서 진행합니다 (코드는 고객 GitHub 저장소에서 `git clone`한 것).
1. **고객이 직접 로그인**: `vercel login` (고객 계정)
2. 새 프로젝트 연결: `vercel link` → 새 프로젝트 이름(예: `igsc-chatbot`) 생성
3. **환경 변수 입력** (`vercel env add 이름 production`, 값은 화면에서 입력 — 채팅·문서에 붙여 넣지 않음):

| 이름 | 값 | 비고 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | 이전된 프로젝트 주소 | 이전 후에도 동일 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon 키 | |
| `SUPABASE_SERVICE_ROLE_KEY` | service role 키 | 민감 변수로 저장 |
| `ANTHROPIC_API_KEY` | **고객 Console에서 만든 새 키** | 민감 변수 |
| `ADMIN_ALLOWED_EMAILS` | 관리자 3명 이메일(쉼표) | 개발 담당 이메일 제거 |
| `NEXT_PUBLIC_SITE_URL` | 정식 도메인 주소 | 로그인 링크 돌아올 주소 |
| `CRON_SECRET` | 새로 만든 임의 문자열 (예: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) | 민감 변수 |
| `RESEND_API_KEY` | 고객 Resend 새 키 | 민감 변수 |
| `ALERT_EMAIL_FROM` | 인증한 도메인의 발신 주소 | |
| `CHAT_FRAME_ANCESTORS` | 챗봇을 넣을 홈페이지 주소(공백 구분) | 비우면 모든 사이트 허용 |

   > `SEARCH_DEBUG_ENABLED`는 **설정하지 않습니다.**
4. **Functions Region**을 Supabase와 같은 지역으로 설정 (Settings → Functions).
5. 배포: `vercel deploy --prod`
6. **자동 점검 주기**: Pro 요금제면 `vercel.json`의 `0 0 * * *`(하루 1회)을 `*/30 * * * *`로 바꾸고 재배포합니다. (Hobby에서는 하루 1회까지만 배포가 허용됩니다.)

### B-5. 도메인 연결
1. Vercel → 프로젝트 → Settings → Domains → 정식 도메인 추가
2. 안내되는 DNS 레코드를 고객의 **DNS 담당자**가 도메인 관리 화면에 추가합니다.
3. 연결이 확인되면 `NEXT_PUBLIC_SITE_URL`이 이 주소인지, Supabase Redirect URLs가 맞는지 다시 확인하고 **재배포**합니다.

### B-6. 알림 메일 (Resend)
1. 고객 Resend 계정에서 도메인 인증(DNS 레코드)을 완료합니다.
2. `ALERT_EMAIL_FROM`을 인증한 도메인 주소로 설정하고 재배포합니다.
3. 시험: 아래 B-7의 알림 점검 참고. 관리자 3명 모두에게 도착하는지 확인합니다.

### B-7. 정상 동작 점검 (키 재발급 전에 반드시)
```
npm run smoke:deploy -- https://{새 주소}
npm run golden -- --safety
```
수동 점검표 (고객과 함께):

- [ ] `{주소}/chat` 화면, 추천 질문 → 승인 FAQ 0건이면 담당자 안내/되묻기 (A-4 수정 후 동작 확인)
- [ ] `{주소}/admin/login` — 관리자 **3명 모두** 로그인 메일 수신·로그인
- [ ] FAQ·미답변·로그·문서 보관함·인증 종류·운영 상태 화면
- [ ] 문서 보관함 파일 **내려받기** 1건 (저장소 이전 확인)
- [ ] 테스트 FAQ 1건: 초안 → 승인 → 챗봇이 답 → 초안으로 되돌림(또는 삭제)
- [ ] 컨설팅 질문 거절, 불만 문장 → 담당자 안내
- [ ] **유입 채널**: `/admin/channels` 가 열리고 링크가 새 주소 기준으로 만들어진다. 채널 링크(예: `…/chat?src=instagram&c=test`)로 시험 질문 → 표에 반영 (마이그레이션 0012 적용 확인)
- [ ] 홈페이지 위젯: 삽입 코드로 열린 챗봇의 질문이 **홈페이지** 채널로 기록된다 (`data-src` 기본값 homepage)
- [ ] 운영 상태 화면: DB·AI 정상
- [ ] 알림 점검: `GET {주소}/api/cron/monitor` 에 `Authorization: Bearer {CRON_SECRET}` 헤더를 붙여 호출 → 응답의 `status`·`alert` 확인 (문제가 있어야 메일이 갑니다. 시험은 운영 상태가 '주의'일 때 가능)
- [ ] `/admin` 이 로그인 없이는 열리지 않음 (smoke 항목에 포함)
- [ ] 보안 헤더: `/chat`은 iframe 허용, `/admin`은 차단 (smoke 항목에 포함)
- [ ] 점검으로 생긴 대화 기록·미답변 정리: `npx tsx scripts/delete-chat-log.ts --all` (미리보기 확인 후 `--apply`)

### B-8. 키 재발급 (점검 통과 후)
순서가 중요합니다. **새 키 발급 → 서버 환경 변수 교체 → 재배포 → 동작 확인 → 옛 키 폐기.**

| 키 | 방법 | 서버 반영 |
|---|---|---|
| Supabase API 키 | **Settings > API Keys**에서 새 secret 키·publishable 키 생성 → 서버 환경 변수 교체 → 재배포 → 동작 확인 후 **옛 키 삭제**(secret 키 삭제는 영구적, 기존 anon/service_role 키는 비활성화로 되돌릴 수 있음). 공식 문서는 "모든 곳이 새 키로 바뀐 것을 확인한 뒤 옛 키를 삭제"하도록 안내 | 환경 변수 2~3개 교체 → 재배포 |
| Anthropic | 개발 계정 키 폐기 (고객 키는 이미 사용 중) | 이미 고객 키로 교체됨 |
| Resend | 개발 계정 키 폐기 (고객 키는 이미 사용 중) | 이미 고객 키로 교체됨 |
| `CRON_SECRET` | 고객 배포에서 새로 만든 값 사용 중 | 해당 없음 |
| Vercel 토큰 | 개발 PC의 `vercel logout` | — |

Supabase 키를 재발급하면 **개발 계정의 옛 Vercel 프로젝트**는 동작하지 않게 됩니다. 이것이 의도입니다. 새 서버가 정상인 것을 확인한 뒤에만 합니다.

### B-9. 위젯 삽입 코드·채널 링크 전달
`docs/widget-install.md`의 `{챗봇 도메인}`을 정식 주소로 바꿔 홈페이지 담당 업체에 전달합니다. 그리고 고객에게 **관리자 → 유입 채널**에서 채널별 링크를 복사해 거는 방법(인수 가이드 9장)을 안내합니다. **정식 도메인이 확정되기 전에 채널 링크를 걸지 않도록** 합니다(주소가 바뀌면 이미 건 링크를 모두 교체해야 함). (삽입 일정은 고객이 FAQ 승인을 어느 정도 한 뒤로 잡는 것을 권장 — 승인 0건이면 챗봇이 답을 못 합니다.)

### B-10. 폐기와 권한 회수
- [ ] 개발 계정의 Vercel 프로젝트 `igsc-chatbot` **삭제** (또는 중지) — 옛 주소 `igsc-chatbot.vercel.app` 폐기
- [ ] 개발 계정의 Anthropic·Resend 키 **폐기**, 개발 PC의 `.env.local` 삭제 또는 새 키로 교체
- [ ] 개발 PC의 백업 폴더(`data/backup/`)와 `docs/customer-files/`: 고객 요구에 따라 **삭제** 또는 안전한 보관
- [ ] 고객 Supabase 조직에서 개발 담당자 **권한 제거** (필요하면 지원 시에만 임시 초대)
- [ ] 고객 GitHub 저장소 소유권 확인 (개발 담당자는 권한 제거 또는 읽기 권한)
- [ ] 고객 Vercel 팀·계정에 개발 담당자가 남아 있다면 제거

---

## C. 인계 후

### C-1. 인수 확인서
「인수 가이드 (고객용)」 6-4의 확인서를 양쪽이 서명합니다.

### C-2. 지원 범위 합의 (문서로 남기세요)
- 지원 기간(예: 인계 후 N개월 무상 하자 보수)
- 지원 범위: 포함(버그 수정, 인증 이력 입력, 관리자 변경, 장애 대응) / 별도(기능 추가, FAQ 작성 대행, Next.js 메이저 업그레이드)
- 응답 시간(예: 영업일 기준 당일/익일), 긴급 연락 방법
- 고객이 Claude Code로 직접 변경한 부분의 책임 범위

### C-3. 알려진 한계·기술 부채 (고객에게 전달)
| 항목 | 내용 |
|---|---|
| 인증 이력 입력 화면 없음 | 현재는 데이터베이스(Supabase Table Editor)에서 직접 입력 |
| 관리자 추가·삭제 | 환경 변수(`ADMIN_ALLOWED_EMAILS`) 수정 + 재배포 |
| FAQ 검색 방식 | 목록 전체를 AI에 보내는 방식(임베딩 없음). 승인 FAQ 약 500건 넘으면 응답 속도·비용 점검, 필요 시 검색 모듈(`lib/search/`) 교체 (인터페이스 `searchFaq()` 유지) |
| 의존성 취약점 | `npm audit`의 next/postcss 2건 — 해결은 Next 16 업그레이드 필요 |
| 자동 점검 주기 | Hobby는 하루 1회(시간 정밀도 ±59분), Pro는 1분 간격까지 가능 → `*/30 * * * *` |
| Supabase 기존 키 폐지 | 기존 anon/service_role 키는 2026년 말까지 단계적 폐지 예정. A-4의 새 키 호환 검증 결과를 인수인계 |
| Anthropic 한도 | 새 조직은 낮은 한도의 Evaluation 단계에서 시작할 수 있음. 월 지출 한도·자동 충전은 고객이 Billing에서 설정 |
| 대화 로그 | 계속 쌓임. 보관 기간 정책 필요 |
| 한국어만 지원 | 외국어는 담당자 연결 |
| 유입 채널 집계 | 질문한 방문만 집계(방문·클릭 수는 미집계). 채널 추가는 `lib/channels.ts` 한 줄(Claude Code로 요청). 0012 적용 전 대화는 채널 없음 |
| 인계 시점 데이터 | 인계 직전 값으로 기록: 승인 FAQ(원칙 0건), FAQ 초안, 인증 이력(비공개), 대화·미답변 |

### C-4. 인계 후 1~2주 점검 (선택)
- 운영 상태 화면과 알림 메일 수신 확인
- 고객의 첫 FAQ 승인 과정 지원 (검수 화면 시연)
- 대표 질문 점검 `npm run golden` (승인 FAQ가 쌓인 뒤)

---

## 부록 A. 시스템 구성

| 영역 | 위치 |
|---|---|
| 챗봇 화면 | `app/chat/`, `components/chat/`, 삽입 스크립트 `public/widget.js` |
| 관리자 화면 | `app/admin/(panel)/` (FAQ, 미답변, 문서, 로그, **유입 채널**, 인증 종류, 운영 상태) |
| API | `app/api/chat`, `app/api/admin/*`, `app/api/health`, `app/api/cron/monitor` |
| 업무 로직 | `lib/chat/`(처리 순서), `lib/search/`(FAQ 선택), `lib/docs/`(문서→초안), `lib/monitor/`, `lib/rate-limit.ts`, `lib/channels.ts`(유입 채널), `lib/admin/channel-stats.ts` |
| DB 접근 | `lib/db/` (서버 전용, service role) |
| 프롬프트 | `lib/prompts/` (코드에 인라인 금지) |
| 마이그레이션 | `supabase/migrations/0001`~`0012` |
| 테스트 | `tests/` (단위·시나리오), 대표 질문 `tests/golden/cases.ts` |
| 스크립트 | `scripts/` (백업, 삭제, 승인 초기화, 점검 등) |
| 규칙 | `CLAUDE.md` |

## 부록 B. 운영용 스크립트

| 스크립트 | 용도 | 비고 |
|---|---|---|
| `scripts/export-backup.ts` | 전체 백업 | 읽기만 함 |
| `scripts/reset-faq-approval.ts` | 승인 되돌리기·복원 | 기본 미리보기, `--apply` |
| `scripts/delete-chat-log.ts` | 대화 기록 삭제 | 백업 후 삭제 |
| `scripts/delete-unanswered-before.ts` | 미답변 삭제 | 백업 후 삭제 |
| `scripts/smoke-deploy.ts` | 배포 후 자동 점검 | `npm run smoke:deploy -- 주소` |
| `scripts/golden.ts` | 대표 질문 점검 | `npm run golden` |
| `scripts/backfill-content-hash.ts` | 문서 해시 채우기 | 마이그레이션 0010 후 1회 |
| `scripts/load-cost-duration-faqs.ts` | 고객이 준 비용·기간으로 FAQ 초안 등록(기존 비용·기간 초안 삭제) | 일회성. 기본 미리보기, `--apply` |
| 그 외 `load-*`, `draft-*`, `verify-*`, `compare-*`, `analyze-*` | 개발 중 일회성 작업 | 정리 대상(A-2) |

## 부록 C. Supabase를 이전하지 않고 새로 만드는 경우

고객 조직 조건 때문에 이전이 안 될 때만 씁니다. 작업량이 크고 누락 위험이 있습니다.
1. 고객 조직에 새 프로젝트 생성(Pro).
2. SQL Editor에서 `supabase/migrations/0001` ~ `0012`을 **순서대로** 실행. (`0009`는 인증 종류 51건이 시드로 들어감)
3. 백업(`data/backup/full-*/`)의 테이블 JSON을 새 프로젝트에 가져옴 — 참조 순서(`documents` → `doc_chunks`, `faq`, `cert_history` …)를 지켜 `service role`로 삽입. 가져오기 스크립트는 현재 없으므로 필요하면 새로 작성·검증해야 함.
4. Storage `documents` 버킷(비공개)을 만들고 백업의 `files/`를 올림. 파일 이름은 `documents.storage_path`와 같아야 함.
5. 새 URL·키로 모든 환경 변수를 교체하고 Auth 설정(URL Configuration, SMTP)을 다시 함. 관리자 계정은 처음 로그인할 때 자동 생성됨.
6. 행 수·파일 수를 백업 manifest와 대조.

## 부록 D. 장애 대응 요약 (인계 후 고객 질문에 대비)

| 증상 | 1차 확인 | 조치 |
|---|---|---|
| 모든 질문이 담당자 이관 | 운영 상태 → AI 실패 | Anthropic 크레딧·키 확인 |
| 관리자 로그인 불가 | 이메일이 `ADMIN_ALLOWED_EMAILS`에 있는지, 메일 한도 | 환경 변수·SMTP |
| 챗봇 화면 오류 | Vercel 배포 상태·로그 | 이전 배포로 롤백 (`vercel rollback`) |
| DB 연결 실패 | Supabase 프로젝트 상태(일시 정지 여부) | 요금제·상태 확인 |
| 질문 폭증 | 오늘 질문 수, 하루 상한 | 환경 변수 `RATE_*` 조정 |

## 부록 E. 확인한 공식 문서 (확인일 2026-10-04)

이 문서의 외부 서비스 정보(요금·제한·설치·이전 조건)는 아래 공식 문서를 **2026-10-04에 직접 확인**해서 반영했습니다. 서비스는 바뀔 수 있으므로 실행하기 전에 한 번 더 확인하세요.

| 서비스 | 확인한 내용 | 출처 |
|---|---|---|
| Vercel | 무료(Hobby)는 비상업·개인용만 허용, 크론은 하루 1회(시간 정밀도 ±59분)만 가능, 함수 최대 실행 300초. Pro는 크론 1분 간격, 사용자(개발자 좌석) 1명당 월 $20, 열람자(Viewer) 좌석은 무료 | vercel.com/docs/plans/hobby, vercel.com/docs/cron-jobs/usage-and-pricing |
| Vercel | 프로젝트 삭제는 Settings → General의 Delete Project. 삭제하면 배포·도메인·환경 변수가 함께 삭제됨. 프로젝트 일시 중지(Pause Project) 기능이 있음 | vercel.com/docs/projects/managing-projects |
| Supabase | Pro는 월 $25부터. 무료 프로젝트는 1주 동안 활동이 없으면 일시 정지, Pro는 비활성으로 정지되지 않음. Pro는 일일 백업 7일 보관 | supabase.com/pricing |
| Supabase | 프로젝트 이전은 프로젝트의 General settings에서 시작. **원래 조직의 소유자(Owner)** 가 시작하고, **대상 조직에서는 멤버(Member) 이상**이어야 함(역할: Owner / Administrator / Developer / Read-Only). Administrator는 프로젝트 이전·조직 설정 변경·소유자 추가 권한이 없고, 초대는 이메일로 가며 24시간 유효. 프로젝트 단위 역할이 있으면 이전이 막힘. GitHub 연동·프로젝트 단위 역할·로그 드레인이 켜져 있으면 이전 불가. 지역(리전)이 다른 조직으로는 이전 불가. 무료 요금제로 이전하면 1~2분 중단 가능 | supabase.com/docs/guides/platform/project-transfer |
| Supabase | API 키: 기존 anon/service_role 키는 2026년 말까지 단계적으로 폐지 예정, 새 키(publishable `sb_publishable_…`, secret `sb_secret_…`)로 전환 중. 키 교체는 Settings > API Keys | supabase.com/docs/guides/api/api-keys |
| Claude Code | Windows 10 1809 이상. 설치: PowerShell `irm https://claude.ai/install.ps1 | iex`, CMD, 또는 `winget install Anthropic.ClaudeCode`. 관리자 권한 불필요. Node.js 필요 없음(npm 설치 시에만 Node 22 이상). Git for Windows는 선택(있으면 Bash 도구 사용). 확인: `claude --version`, `claude doctor`. 계정: Pro, Max, Team, Enterprise, Console 중 하나(무료 claude.ai 플랜은 제외) | code.claude.com/docs/en/setup |
| Anthropic API | 월 지출 한도: Console의 Settings > Billing > Spend limits(Set limit/Adjust limit). 새 조직은 낮은 한도의 Evaluation 단계에서 시작할 수 있고 사용 이력에 따라 올라감. 내가 정한 한도에 도달하면 요청이 HTTP 400(`invalid_request_error`), 단계별 월 상한에 도달하면 HTTP 429로 막히며 다음 달 1일 00:00 UTC에 풀림. 크레딧 자동 충전(auto-reload)은 Billing 화면에서 설정 | platform.claude.com/docs/en/api/rate-limits, support.anthropic.com (결제 안내) |

**이번에 확인하지 못한 것**: Vercel 프로젝트 이전 기능의 세부 조건(이 가이드는 이전 대신 새 배포를 사용), Supabase 새 키로 전환했을 때 이 시스템과의 호환(A-4 참고), Anthropic Console의 잔액 알림 정확한 메뉴(운영 상태 화면의 AI 점검과 알림 메일이 대신 감지합니다).
