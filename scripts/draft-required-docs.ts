/**
 * 인증별 필요서류 PDF → FAQ 초안 미리보기 생성 (DB에 쓰지 않음).
 * 실행: npx tsx scripts/draft-required-docs.ts   → data/inquiry/required-docs-drafts.json, docs/required-docs-drafts.md
 *
 * 흐름: PDF 텍스트 추출(pymupdf 대신 unpdf) → AI가 표를 JSON 으로 구조화 →
 *       모든 title/item 이 원문에 그대로 있는지 검증(없으면 폐기·기록) → 답변 텍스트를 코드로 조립.
 */
import Anthropic from "@anthropic-ai/sdk";
import { config } from "dotenv";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDocumentProxy, extractText } from "unpdf";
import { REQUIRED_DOCS_SYSTEM } from "../lib/prompts/doc-required-faq";

config({ path: ".env.local" });

const DIR = "docs/customer-files/IGSC AI 챗봇 구축 요청 서류_261002/3. 인증자료-인증절차, 필요서류/인증별 필요서류";

interface Spec { match: string; skip?: boolean; certs: { cert: string; label: string }[]; kind: "docs" | "docs+onsite" | "docs+banned" | "event" }
const SPECS: Spec[] = [
  { match: "Calorie-free", certs: [{ cert: "calorie-free", label: "Calorie-free(칼로리프리)" }], kind: "docs" },
  { match: "GMO-free", certs: [{ cert: "non-gmo", label: "GMO-free(Non-GMO)" }], kind: "docs" },
  { match: "Gluten-free", certs: [{ cert: "gluten-free", label: "글루텐프리(Gluten free)" }], kind: "docs" },
  { match: "Ketogenic", certs: [{ cert: "ketogenic-friendly", label: "키토제닉 친화(Ketogenic friendly)" }], kind: "docs" },
  { match: "Lactose-free", certs: [{ cert: "lactose-free-dairy-free", label: "무유당·무유제품(Lactose-free / Dairy-free)" }], kind: "docs" },
  { match: "Sugar-free 인증의", certs: [{ cert: "sugar-free", label: "무설탕(Sugar free)" }], kind: "docs" },
  { match: "Upcycle", certs: [{ cert: "upcycle", label: "업사이클(Upcycle)" }], kind: "docs" },
  { match: "무가당", certs: [{ cert: "no-added-sugar", label: "무가당(No Added Sugar)" }], kind: "docs" },
  { match: "반려동물", certs: [{ cert: "pet-related-product", label: "반려동물 관련 제품" }], kind: "docs" },
  { match: "비건 이벤트", certs: [{ cert: "vegan", label: "비건 이벤트" }], kind: "event" },
  { match: "비건인증의", certs: [{ cert: "vegan", label: "비건(Vegan)" }], kind: "docs+onsite" },
  { match: "금지성분포함", certs: [{ cert: "coral-reef-friendly", label: "산호초 보호(Coral Reef-friendly)" }], kind: "docs+banned" },
  { match: "산호초 보호(Coral Reef-friendly) 인증의 필요 서류v1", skip: true, certs: [], kind: "docs" }, // 금지성분 포함본의 부분집합
  { match: "제로웨이스트, 플라스틱", certs: [{ cert: "zero-waste", label: "제로웨이스트 이벤트" }, { cert: "plastic-free", label: "플라스틱 프리 이벤트" }], kind: "event" },
  { match: "제품인증의 필요 서류", certs: [{ cert: "common", label: "제품 인증(식품 계열 제품 인증 공통)" }], kind: "docs" },
];

const norm = (s: string) => s.replace(/[\s\-•·*()（）\[\]/,.:;"'“”‘’]/g, "").toLowerCase();

interface Struct { docs?: { sections: { title: string; items: string[] }[]; notes: string[] }; onsite?: { sections: { title: string; items: string[] }[] } | null; banned?: string[] | null }

function verify(s: Struct, src: string) {
  const bad: string[] = [];
  const ns = norm(src);
  const chk = (t: string) => { if (t.trim() && !ns.includes(norm(t))) bad.push(t); };
  for (const sec of s.docs?.sections ?? []) { chk(sec.title); sec.items.forEach(chk); }
  (s.docs?.notes ?? []).forEach(chk);
  for (const sec of s.onsite?.sections ?? []) { chk(sec.title); sec.items.forEach(chk); }
  (s.banned ?? []).forEach(chk);
  return bad;
}

const render = (sections: { title: string; items: string[] }[]) =>
  sections.map((s) => `■ ${s.title}\n${s.items.map((i) => `- ${i}`).join("\n")}`).join("\n\n");

async function main() {
  const files = (await readdir(DIR)).filter((f) => f.endsWith(".pdf")).sort();
  const ai = new Anthropic();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: any[] = [];
  const problems: string[] = [];
  for (const f of files) {
    const spec = SPECS.find((s) => f.includes(s.match) || f.normalize("NFC").includes(s.match.normalize("NFC")));
    if (!spec) { problems.push(`매핑 없는 파일: ${f}`); continue; }
    if (spec.skip) { console.log(`[skip] ${f} (다른 파일의 부분집합)`); continue; }
    const pdf = await getDocumentProxy(new Uint8Array(await readFile(path.join(DIR, f))));
    const { text } = await extractText(pdf, { mergePages: true });
    const res = await ai.messages.create({ model: "claude-sonnet-5-5", max_tokens: 4000, system: REQUIRED_DOCS_SYSTEM, messages: [{ role: "user", content: text }] });
    if (res.stop_reason !== "end_turn") throw new Error(`중단 ${f}`);
    const t = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const st: Struct = JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1));
    const bad = verify(st, text);
    if (bad.length) problems.push(`${f}: 원문에 없는 문구 ${bad.length}건 → ${bad.slice(0, 3).join(" | ")}`);
    console.log(`[draft] ${f} 검증 ${bad.length ? "실패 " + bad.length : "통과"}`);

    for (const c of spec.certs) {
      const docsBody = `${render(st.docs?.sections ?? [])}${st.docs?.notes?.length ? `\n\n[참고]\n${st.docs.notes.map((n) => `- ${n.replace(/^\*\s*/, "")}`).join("\n")}` : ""}`;
      const isEvent = spec.kind === "event";
      out.push({ file: f, cert: c.cert, category: "document", question: `${c.label} 인증 신청 시 필요한 서류는 무엇인가요?`.replace("이벤트 인증 인증", "이벤트 인증").replace("제품 인증(식품 계열 제품 인증 공통) 인증", "식품 계열 제품 인증"), answer: `${isEvent ? "신청 전·후에 다음 서류가 필요합니다." : "다음 서류가 필요합니다."}\n\n${docsBody}`, evidence: [docsBody], verified: bad.length === 0 });
      if (st.onsite?.sections?.length) {
        const body = render(st.onsite.sections);
        out.push({ file: f, cert: c.cert, category: "procedure", question: `${c.label} 인증 현장심사에서는 무엇을 확인하나요?`.replace("이벤트 인증 인증", "이벤트 인증"), answer: `현장심사에서는 다음 사항을 확인합니다.\n\n${body}`, evidence: [body], verified: bad.length === 0 });
      }
      if (st.banned?.length) {
        const body = st.banned.map((b) => `- ${b}`).join("\n");
        out.push({ file: f, cert: c.cert, category: "scope", question: `${c.label} 인증에서 사용할 수 없는 금지 성분은 무엇인가요?`, answer: `다음 성분은 금지 성분입니다.\n\n${body}`, evidence: [body], verified: bad.length === 0 });
      }
    }
  }
  await writeFile("data/inquiry/required-docs-drafts.json", JSON.stringify(out, null, 1), "utf8");
  const md = [`# 필요서류 PDF → FAQ 초안 미리보기 (${out.length}건)\n`, `DB에 등록하기 전 검토용. 원문에 없는 문구가 검출된 파일: ${problems.length ? "\n" + problems.map((p) => `- ${p}`).join("\n") : "없음"}\n`, ...out.map((d, i) => `## ${i + 1}. ${d.question}\n- 인증: \`${d.cert}\` · 분류: ${d.category} · 출처: ${d.file} · 검증: ${d.verified ? "통과" : "실패"}\n\n\`\`\`\n${d.answer}\n\`\`\`\n`)].join("\n");
  await writeFile("docs/required-docs-drafts.md", md, "utf8");
  console.log(`[draft] ${out.length}건 생성. 문제 ${problems.length}건`, problems);
}
main().catch((e) => { console.error(e); process.exit(1); });
