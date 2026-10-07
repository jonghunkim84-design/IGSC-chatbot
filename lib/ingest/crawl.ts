/**
 * igsc.kr 공개 페이지 텍스트 수집.
 * 실행: npm run ingest:crawl
 * 출력: data/raw/*.json  { url, title, text, fetched_at }
 * 이미 수집한 URL(파일 존재)은 건너뛴다. 삭제 후 재실행하면 다시 수집.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE = "https://igsc.kr";
const USER_AGENT = "IGSC-FAQ-Ingest/1.0 (+https://igsc.kr; contact: igsc@igsc.kr)";
const DELAY_MS = 1000;
const RAW_DIR = path.join(process.cwd(), "data", "raw");

// 인증 절차·품질규정·공평성 등 고정 페이지
const STATIC_PAGES = [
  "/certification",
  "/verification",
  "/company/about-igsc",
  "/company/Impartiality",
  "/company/ensuring-fairness-1220",
  "/company/quality-regulations",
  "/company/non discriminatory conditions",
  "/company/complaints/appeals-process",
];

// 하위 목록을 가진 상세 페이지 루트
const LIST_ROOTS = [
  "/certification/certification-list",
  "/verification/vertification-list",
];

export interface RawDoc {
  url: string;
  title: string;
  text: string;
  fetched_at: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let lastRequestAt = 0;

async function fetchHtml(url: string): Promise<string> {
  const wait = lastRequestAt + DELAY_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
  const res = await fetch(encodeURI(url), { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

const ENTITIES: Record<string, string> = {
  "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&times;": "×",
};

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/g, "")
    .replace(/<\/(p|div|li|tr|h[1-6]|table|ul|ol|article|section)>|<br\s*\/?>/gi, "\n")
    .replace(/<\/t[dh]>/gi, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z#0-9]+;/gi, (m) => ENTITIES[m] ?? " ")
    .replaceAll(String.fromCharCode(13), "")
    .replace(/[ ​ ]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/** 본문 영역(#subConts ~ footer)만 추출. 메뉴·푸터는 제외. */
function extractMain(html: string, url: string): { title: string; text: string } {
  const start = html.indexOf('<section id="subConts"');
  const end = html.indexOf("<footer", start);
  if (start < 0) throw new Error("본문 영역(#subConts)을 찾지 못함");
  const text = htmlToText(html.slice(start, end < 0 ? undefined : end));
  // 페이지 <title>은 사이트 공통이라 본문 첫 줄(들)을 제목으로 쓴다.
  const lines = text.split("\n");
  return { title: url.includes("product/view") ? lines.slice(0, 2).join(" / ") : lines[0] ?? "", text };
}

function fileFor(url: string): string {
  const hash = createHash("sha1").update(url).digest("hex").slice(0, 10);
  return path.join(RAW_DIR, `${hash}.json`);
}

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

/** 목록 루트 → 카테고리 목록 → 상세(view) URL 수집 */
async function discoverDetailUrls(root: string): Promise<string[]> {
  const rootHtml = await fetchHtml(BASE + root);
  const cats = uniq([...rootHtml.matchAll(/\?tpf=product\/list&category_code=(\d+)/g)].map((m) => m[1]));
  const urls: string[] = [];
  for (const cat of cats) {
    try {
      const html = await fetchHtml(`${BASE}${root}?tpf=product/list&category_code=${cat}`);
      for (const m of html.matchAll(/\?tpf=product\/view&category_code=(\d+)&code=(\d+)/g)) {
        urls.push(`${BASE}${root}?tpf=product/view&category_code=${m[1]}&code=${m[2]}`);
      }
    } catch (err) {
      console.error(`[crawl] 카테고리 목록 실패 ${root} ${cat}:`, err);
    }
  }
  return uniq(urls);
}

async function main() {
  await mkdir(RAW_DIR, { recursive: true });

  const targets: string[] = STATIC_PAGES.map((p) => BASE + p);
  for (const root of LIST_ROOTS) {
    targets.push(BASE + root);
    try {
      const found = await discoverDetailUrls(root);
      console.log(`[crawl] ${root}: 상세 ${found.length}건 발견`);
      targets.push(...found);
    } catch (err) {
      console.error(`[crawl] 목록 탐색 실패 ${root}:`, err);
    }
  }

  let ok = 0, skipped = 0, failed = 0;
  for (const url of uniq(targets)) {
    const file = fileFor(url);
    if (existsSync(file)) {
      skipped++;
      continue;
    }
    try {
      const { title, text } = extractMain(await fetchHtml(url), url);
      if (text.length < 50) throw new Error(`본문이 너무 짧음(${text.length}자)`);
      const doc: RawDoc = { url, title, text, fetched_at: new Date().toISOString() };
      await writeFile(file, JSON.stringify(doc, null, 2), "utf8");
      ok++;
      console.log(`[crawl] OK ${text.length}자 ${url}`);
    } catch (err) {
      failed++;
      console.error(`[crawl] FAIL ${url}:`, err instanceof Error ? err.message : err);
    }
  }
  console.log(`[crawl] 완료: 신규 ${ok}, 건너뜀 ${skipped}, 실패 ${failed}`);
}

main().catch((err) => {
  console.error("[crawl] 치명적 오류:", err);
  process.exit(1);
});
