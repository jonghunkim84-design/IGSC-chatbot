/**
 * data/raw/*.json → data/faq-draft.json + data/faq-draft.csv
 * 실행: npm run ingest:generate
 *
 * 환각 방지 장치:
 *  - 프롬프트: 원문에 없는 내용 금지, evidence(원문 그대로 복사) 필수
 *  - 코드 검증: evidence가 원문에 실제로 존재하는지, 답변 속 숫자가 원문에 있는지 확인 → 실패 항목은 제외하고 로그
 *  - 비용·기간: 원문에 명시된 경우만 채우고, 나머지는 인증별 placeholder(answer 빈 값, needs_input: true)
 * 결과는 전부 status='draft'. 사람이 검수(CSV)한 뒤 승인한다.
 */
import Anthropic from "@anthropic-ai/sdk";
import { config } from "dotenv";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  FAQ_EXTRACT_SYSTEM,
  FAQ_EXTRACT_TOOL,
  FAQ_MERGE_SYSTEM,
  FAQ_MERGE_TOOL,
} from "../prompts/faq-extract";
import type { FaqCategory } from "../db/types";
import type { RawDoc } from "./crawl";
import { certName } from "../cert-names";
import { norm, validateEvidence } from "./evidence";
import { placeholderText } from "./cert-labels";
import { toCsv } from "./csv";

config({ path: ".env.local" });

const MODEL = "claude-sonnet-5-5";
const DATA = path.join(process.cwd(), "data");
const RAW_DIR = path.join(DATA, "raw");
const CACHE_DIR = path.join(DATA, "cache", "faq-extract");
const LOGO_MARKER = "인증마크 사용 권한";
const UI_NOISE = new Set(["신청하기", "소개", "진행절차", "인증 마크 사용"]);
const MIN_TEXT_LEN = 150;

export interface DraftFaq {
  id: string;
  question: string;
  variants: string[];
  answer: string;
  cert_type: string;
  category: FaqCategory;
  source_url: string;
  lang: "ko";
  status: "draft";
  needs_input: boolean;
  /** 검수용 (DB에는 적재하지 않음) */
  evidence: string[];
  /** 병합 허용 범위 키 (대분류가 다른 페이지끼리는 병합하지 않는다) */
  merge_key: string;
  source_urls: string[];
}

/** 제목의 대분류. 식품/화장품처럼 기준이 다른 대분류는 병합 금지, 지속가능성/협력서비스는 같은 인증이 중복 게재되므로 병합 허용. */
function mergeKeyOf(title: string): string {
  const g = title.split(" / ")[0].trim();
  return g === "지속가능성" || g === "협력서비스" ? "pool" : g;
}

interface Unit {
  url: string;
  title: string;
  text: string;
  forcedCertType?: string;
}

const client = new Anthropic();

function faqId(sourceUrl: string, question: string): string {
  const h = createHash("sha1").update(`${sourceUrl}|${norm(question)}`).digest("hex");
  // UUID 형식 (v5 스타일 비트 세팅)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

async function buildUnits(): Promise<Unit[]> {
  const files = (await readdir(RAW_DIR)).filter((f) => f.endsWith(".json")).sort();
  const docs: RawDoc[] = [];
  for (const f of files) docs.push(JSON.parse(await readFile(path.join(RAW_DIR, f), "utf8")));
  docs.sort((a, b) => a.url.localeCompare(b.url));

  const units: Unit[] = [];
  let logoTail: { url: string; text: string } | null = null;

  for (const d of docs) {
    let text = d.text;
    const i = text.indexOf(LOGO_MARKER);
    if (i >= 0) {
      // 27개 문서에 동일하게 붙은 로고 사용 정책은 한 번만 별도 문서로 처리
      if (!logoTail) logoTail = { url: d.url, text: text.slice(i) };
      text = text.slice(0, i);
    }
    text = text
      .split("\n")
      .filter((l) => !UI_NOISE.has(l.trim()))
      .join("\n")
      .trim();
    if (text.length < MIN_TEXT_LEN) {
      console.log(`[gen] 건너뜀(본문 ${text.length}자): ${d.url}`);
      continue;
    }
    let forced: string | undefined;
    if (d.url.includes("/verification/")) forced = "epd";
    else if (d.url.includes("/company/")) forced = "common";
    units.push({ url: d.url, title: d.title, text, forcedCertType: forced });
  }
  if (logoTail) {
    units.push({
      url: logoTail.url,
      title: "인증마크(로고) 사용 권한 정책",
      text: logoTail.text,
      forcedCertType: "common",
    });
  }
  return units;
}

interface Extracted {
  cert_type: string;
  faqs: { question: string; variants: string[]; answer: string; category: FaqCategory; evidence: string[] }[];
}

async function extract(unit: Unit): Promise<Extracted> {
  const key = createHash("sha1").update(unit.url + unit.title + unit.text.length).digest("hex").slice(0, 12);
  const cacheFile = path.join(CACHE_DIR, `${key}.json`);
  if (existsSync(cacheFile)) return JSON.parse(await readFile(cacheFile, "utf8"));

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: FAQ_EXTRACT_SYSTEM,
    tools: [FAQ_EXTRACT_TOOL],
    tool_choice: { type: "auto" },
    messages: [
      {
        role: "user",
        content: `제목: ${unit.title}\nURL: ${unit.url}\n\n[원문 시작]\n${unit.text}\n[원문 끝]

결과는 반드시 submit_faqs 도구로 제출하세요.`,
      },
    ],
  });
  const block = res.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") throw new Error("tool_use 응답 없음");
  const out = block.input as Extracted;
  await writeFile(cacheFile, JSON.stringify(out, null, 2), "utf8");
  return out;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "common";
}

async function mergeDuplicates(items: DraftFaq[]): Promise<DraftFaq[]> {
  const byType = new Map<string, DraftFaq[]>();
  for (const it of items) {
    const k = `${it.cert_type}::${it.merge_key}`;
    byType.set(k, [...(byType.get(k) ?? []), it]);
  }

  const result: DraftFaq[] = [];
  for (const [type, group] of byType) {
    // 1) 정규화된 질문이 같으면 즉시 병합
    const seen = new Map<string, DraftFaq>();
    const stage1: DraftFaq[] = [];
    for (const it of group) {
      const k = norm(it.question);
      const prev = seen.get(k);
      if (prev) absorb(prev, it);
      else {
        seen.set(k, it);
        stage1.push(it);
      }
    }
    if (stage1.length < 2) {
      result.push(...stage1);
      continue;
    }
    // 2) 의미상 중복은 Claude가 묶음 지정
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: FAQ_MERGE_SYSTEM,
      tools: [FAQ_MERGE_TOOL],
      tool_choice: { type: "auto" },
      messages: [
        {
          role: "user",
          content: stage1.map((it, i) => `${i}. [${it.category}] ${it.question}`).join("\n"),
        },
      ],
    });
    const block = res.content.find((b) => b.type === "tool_use");
    const groups: number[][] = block && block.type === "tool_use" ? (block.input as { groups: number[][] }).groups : [];
    const dropped = new Set<number>();
    for (const g of groups) {
      const valid = [...new Set(g)].filter((i) => Number.isInteger(i) && i >= 0 && i < stage1.length && !dropped.has(i));
      if (valid.length < 2) continue;
      const [head, ...rest] = valid;
      for (const i of rest) {
        absorb(stage1[head], stage1[i]);
        dropped.add(i);
        console.log(`[gen] 병합(${type}): "${stage1[i].question}" → "${stage1[head].question}"`);
      }
    }
    result.push(...stage1.filter((_, i) => !dropped.has(i)));
  }
  return result;
}

function absorb(target: DraftFaq, other: DraftFaq) {
  const variants = new Set([...target.variants, other.question, ...other.variants]);
  variants.delete(target.question);
  target.variants = [...variants].slice(0, 8);
  target.evidence = [...new Set([...target.evidence, ...other.evidence])];
  target.source_urls = [...new Set([...target.source_urls, ...other.source_urls])];
}

/** 비용·기간이 원문에 없는 인증은 빈 답변 placeholder로 분리 */
function addPlaceholders(items: DraftFaq[], labels: Map<string, string>): DraftFaq[] {
  const types = [...new Set(items.map((i) => i.cert_type))];
  const urlFor = (t: string) => items.find((i) => i.cert_type === t)?.source_url ?? "https://igsc.kr";
  const out: DraftFaq[] = [];
  for (const t of types) {
    for (const cat of ["cost", "duration"] as const) {
      const has = items.some((i) => i.cert_type === t && i.category === cat && i.answer.trim());
      if (has) continue;
      const { question: q, variants } = placeholderText(labels.get(t), cat);
      const src = urlFor(t);
      out.push({
        id: faqId(src, q),
        question: q,
        variants,
        answer: "",
        cert_type: t,
        category: cat,
        source_url: src,
        lang: "ko",
        status: "draft",
        needs_input: true,
        evidence: [],
        merge_key: "placeholder",
        source_urls: [src],
      });
    }
  }
  return out;
}

async function main() {
  await mkdir(CACHE_DIR, { recursive: true });
  const units = await buildUnits();
  console.log(`[gen] 처리 대상 ${units.length}건`);

  const drafts: DraftFaq[] = [];
  let rejected = 0;
  let consecutiveFails = 0;
  for (const [n, unit] of units.entries()) {
    try {
      const ex = await extract(unit);
      const certType = unit.forcedCertType ?? slugify(ex.cert_type);
      let kept = 0;
      for (const f of ex.faqs) {
        const why = validateEvidence(f, unit.text); // 공용 검증 (lib/ingest/evidence.ts)
        if (why) {
          rejected++;
          console.warn(`[gen] 제외: "${f.question}" — ${why}`);
          continue;
        }
        kept++;
        drafts.push({
          id: faqId(unit.url, f.question),
          question: f.question.trim(),
          variants: (f.variants ?? []).map((v) => v.trim()).filter(Boolean),
          answer: f.answer.trim(),
          cert_type: certType,
          category: f.category,
          source_url: unit.url,
          lang: "ko",
          status: "draft",
          needs_input: false,
          evidence: f.evidence,
          merge_key: mergeKeyOf(unit.title),
          source_urls: [unit.url],
        });
      }
      consecutiveFails = 0;
      console.log(`[gen] ${n + 1}/${units.length} ${unit.title} → ${kept}건 (${certType})`);
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) {
        console.error("[gen] ANTHROPIC_API_KEY 인증 실패 — 키가 Anthropic 키(sk-ant-...)인지 확인하세요. 중단합니다.");
        process.exit(1);
      }
      console.error(`[gen] 실패 ${unit.url}:`, err instanceof Error ? err.message.slice(0, 300) : err);
      if (++consecutiveFails >= 3) {
        console.error("[gen] 3회 연속 실패 — 중단합니다.");
        process.exit(1);
      }
    }
  }

  const merged = await mergeDuplicates(drafts);
  // slug → 한글 인증명은 lib/cert-names.ts 가 단일 출처 (매핑 없으면 slug 그대로 + 경고 로그)
  const labels = new Map([...new Set(merged.map((i) => i.cert_type))].filter((t) => t !== "common").map((t) => [t, certName(t)]));
  const placeholders = addPlaceholders(merged, labels);
  const all = [...merged, ...placeholders];

  await writeFile(path.join(DATA, "faq-draft.json"), JSON.stringify(all, null, 2), "utf8");
  await writeFile(path.join(DATA, "faq-draft.csv"), toCsv(all), "utf8");
  console.log(
    `[gen] 완료: 원문 기반 ${merged.length}건 + 비용/기간 placeholder ${placeholders.length}건 = ${all.length}건 (검증 탈락 ${rejected}건)`,
  );
}

main().catch((err) => {
  console.error("[gen] 치명적 오류:", err);
  process.exit(1);
});
