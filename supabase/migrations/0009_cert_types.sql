-- 0009: 인증 종류 관리(Phase 14-1) — cert_types 테이블
--
-- 지금까지 인증 종류(cert_type 코드 → 한글명)는 lib/cert-names.ts 코드 파일에 있어 새 인증이 생길 때마다 개발자가 고쳐야 했다.
-- 이 테이블로 옮겨 관리자 화면(/admin/cert-types)에서 추가·수정·비활성화한다.
--   - 아래 INSERT 는 lib/cert-names.ts 의 기존 매핑 전체를 그대로 옮긴 초기 데이터다 (name_ko 는 기존 표기 그대로).
--   - name_en 은 기존 표기 끝의 영문 괄호에서 뽑은 값(없으면 null). category: 식품 | 화장품 | 지속가능성 | 검증 | 기타.
--   - 'common'(공통)은 특정 인증이 아닌 공통 항목용 예약 코드라 화면에서 수정·비활성화할 수 없다.
--   - is_active=false 여도 기존 FAQ·이력·문서는 그대로 유지된다. 신규 등록 선택지에서만 빠진다.
--   - sort_order 0 은 '기본(가나다순)', 1 이상이면 그 순서로 앞에 온다.
-- 서버(service role) 전용이다. 정책이 없으므로 익명·로그인 사용자는 접근할 수 없다. 여러 번 실행해도 안전하다.

create table if not exists public.cert_types (
  code        text primary key check (code ~ '^[a-z0-9-]+$'),
  name_ko     text not null check (length(btrim(name_ko)) > 0),
  name_en     text,
  category    text not null default '기타' check (category in ('식품', '화장품', '지속가능성', '검증', '기타')),
  is_active   boolean not null default true,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);

alter table public.cert_types enable row level security;

-- 초기 데이터: 이미 있는 코드는 건드리지 않는다 (관리자 화면에서 고친 내용을 덮어쓰지 않는다)
insert into public.cert_types (code, name_ko, name_en, category, is_active, sort_order) values
  ('common', '공통', null, '기타', true, 0),
  ('allergens-friendly', '알레르기 친화(Allergens friendly)', 'Allergens friendly', '식품', true, 0),
  ('calorie-free', '칼로리프리(Calorie free)', 'Calorie free', '식품', true, 0),
  ('fat-free', '무지방(Fat free)', 'Fat free', '식품', true, 0),
  ('gluten-free', '글루텐프리(Gluten free)', 'Gluten free', '식품', true, 0),
  ('ketogenic-friendly', '키토제닉 친화(Ketogenic friendly)', 'Ketogenic friendly', '식품', true, 0),
  ('lactose-free-dairy-free', '무유당 / 무유제품(Lactose-free / Dairy-free)', 'Lactose-free / Dairy-free', '식품', true, 0),
  ('no-added-sugar', '무가당(No Added Sugar)', 'No Added Sugar', '식품', true, 0),
  ('non-gmo', '무유전자변형(Non-GMO)', 'Non-GMO', '식품', true, 0),
  ('organic', '유기농(Organic)', 'Organic', '식품', true, 0),
  ('salt-free', '무소금(Salt-free)', 'Salt-free', '식품', true, 0),
  ('sugar-free', '무설탕(Sugar free)', 'Sugar free', '식품', true, 0),
  ('vegan', '비건(Vegan)', 'Vegan', '식품', true, 0),
  ('clean-additive-free', '클린(Additive free)', 'Additive free', '화장품', true, 0),
  ('clean-beauty', '클린뷰티(Clean beauty)', 'Clean beauty', '화장품', true, 0),
  ('coral-reef-friendly', '산호초 보호(Coral Reef-friendly)', 'Coral Reef-friendly', '화장품', true, 0),
  ('microbiome-friendly', 'Microbiome friendly (MyMicrobiome)', 'MyMicrobiome', '화장품', true, 0),
  ('natural-organic', '천연 / 유기농(Natural / Organic)', 'Natural / Organic', '화장품', true, 0),
  ('cradle-to-cradle', 'Cradle to Cradle Certified', null, '지속가능성', true, 0),
  ('earthcheck', 'EarthCheck', null, '지속가능성', true, 0),
  ('flustix', 'Flustix', null, '지속가능성', true, 0),
  ('ocean-bound-plastic', 'Ocean Bound Plastic', null, '지속가능성', true, 0),
  ('plastic-credit-exchange', 'Plastic Credit Exchange', null, '지속가능성', true, 0),
  ('plastic-free', '플라스틱 프리(Plastic free)', 'Plastic free', '지속가능성', true, 0),
  ('upcycle', '업사이클(Upcycle)', 'Upcycle', '지속가능성', true, 0),
  ('zero-waste', '제로웨이스트(Zero-waste)', 'Zero-waste', '지속가능성', true, 0),
  ('zero-waste-japan', 'Zero Waste Japan', null, '지속가능성', true, 0),
  ('environmental-footprint', '조직 및 제품 환경발자국 (OEF, PEF)', null, '검증', true, 0),
  ('epd', '환경성적표지(EPD)', 'EPD', '검증', true, 0),
  ('phd', '제품건강선언(PHD)', 'PHD', '검증', true, 0),
  ('pet-related-product', '반려동물 관련 제품(Pet Related Product)', 'Pet Related Product', '기타', true, 0),
  ('pet-related-service', '반려동물 관련 서비스 (Pet Related Service)', 'Pet Related Service', '기타', true, 0),
  ('defense-equipment', '보호장비 (Defense Equipment)', 'Defense Equipment', '기타', true, 0),
  ('iso-13485', 'ISO 13485 (의료기기 품질관리시스템)', null, '기타', true, 0),
  ('iso-14001', 'ISO 14001 (환경경영시스템)', null, '기타', true, 0),
  ('iso-20000-1', 'ISO 20000-1 (IT 서비스 관리 경영시스템)', null, '기타', true, 0),
  ('iso-22000', 'ISO 22000 (식품안전경영시스템)', null, '기타', true, 0),
  ('iso-22716', 'ISO 22716 (화장품 우수제조관리기준)', null, '기타', true, 0),
  ('iso-27001', 'ISO 27001 (정보보호경영시스템)', null, '기타', true, 0),
  ('iso-45001', 'ISO 45001 (안전보건경영시스템)', null, '기타', true, 0),
  ('iso-50001', 'ISO 50001 (에너지경영시스템)', null, '기타', true, 0),
  ('iso-9001', 'ISO 9001 (품질경영시스템)', null, '기타', true, 0),
  ('allergy-certified', 'Allergy Certified', null, '기타', true, 0),
  ('geo-foundation', 'GEO Foundation', null, '기타', true, 0),
  ('global-greentag', 'Global GreenTag International', null, '기타', true, 0),
  ('jas', 'JAS', null, '기타', true, 0),
  ('keto-project-verified', 'KETO Project Verified', null, '기타', true, 0),
  ('monde-selection', 'Monde Selection', null, '기타', true, 0),
  ('mymicrobiome', 'Mymicrobiome', null, '기타', true, 0),
  ('sugarwise', 'Sugarwise', null, '기타', true, 0),
  ('wso', 'WSO', null, '기타', true, 0)
on conflict (code) do nothing;

-- 확인 (실행 후)
-- select count(*) from public.cert_types;                       -- 51행
-- select category, count(*) from public.cert_types group by 1 order by 1;
