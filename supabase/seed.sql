-- [폐기] Phase 1 임시 시드. 답변이 igsc.kr 원문에 근거하지 않아 DB에서 삭제함. 실행하지 말 것.
-- 비용·기간 수치는 DB에 확정된 값이 없으므로 넣지 않는다. 담당자 입력 후 승인할 것.
insert into public.faq (question, variants, answer, cert_type, category, lang, status, needs_input) values
('비건 인증은 어떤 절차로 진행되나요?',
 array['비건 인증 절차가 궁금합니다','비건 인증 신청부터 발급까지 흐름은?'],
 '비건 인증은 신청서 접수, 서류 검토, 심사, 인증 결정 순서로 진행됩니다. 단계별 세부 사항은 담당자를 통해 안내드립니다.',
 'vegan','procedure','ko','approved',false),
('비건 인증 신청 시 어떤 서류가 필요한가요?',
 array['비건 인증 제출 서류','비건 인증 준비 서류 목록'],
 '신청서와 제품·원료 관련 자료가 필요합니다. 정확한 제출 서류 목록은 신청 접수 시 안내드립니다.',
 'vegan','document','ko','approved',false),
('EPD 인증은 무엇인가요?',
 array['EPD가 뭔가요','환경성적표지(EPD)란'],
 'EPD(환경성적표지)는 제품의 전 과정에서 발생하는 환경 영향을 정량적으로 공개하는 인증입니다.',
 'epd','scope','ko','approved',false),
('인증 갱신은 어떻게 하나요?',
 array['인증 유효기간이 끝나면','갱신 심사 절차'],
 '인증 유효기간 만료 전에 갱신을 신청하셔야 하며, 갱신 절차는 담당자가 안내드립니다.',
 'common','renewal','ko','approved',false),
('EPD 인증 비용은 얼마인가요?',
 array['EPD 심사 비용','EPD 인증 수수료'],
 '(담당자 입력 필요: 확정된 비용 값)',
 'epd','cost','ko','draft',true);
