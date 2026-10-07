/**
 * igsc.kr 인증현황(certification-status) 수집.
 * 실행: npm run ingest:history
 * 출력: data/cert-history-raw.json  [{ company, product, scheme, cert_no, issued, expires, code }]
 * 목록 페이지를 돌며 상세(code) 번호를 모으고, 상세의 인증 표(본인 + 연관 인증)를 파싱한다.
 * 인증번호 기준으로 중복 제거. DB에는 쓰지 않는다.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE = "https://www.igsc.kr/certified-and-qualified";
const USER_AGENT = "IGSC-FAQ-Ingest/1.0 (+https://igsc.kr; contact: igsc@igsc.kr)";
const DELAY_MS = 1000;
const OUT = path.join(process.cwd(), "data", "cert-history-raw.json");

export interface RawCert {
  company: string;
  product: string;
  scheme: string;
  cert_no: string;
  issued: string;
  expires: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let last = 0;

async function fetchHtml(url: string): Promise<string> {
  const wait = last + DELAY_MS - Date.now();
  if (wait > 0) await sleep(wait);
  last = Date.now();
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

const clean = (s: string) =>
  s.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

function parseRows(html: string): RawCert[] {
  const rows: RawCert[] = [];
  for (const tr of html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const td = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => clean(m[1]));
    if (td.length === 6 && /^IGSC-/i.test(td[3])) {
      rows.push({ company: td[0], product: td[1], scheme: td[2], cert_no: td[3], issued: td[4], expires: td[5] });
    }
  }
  return rows;
}

async function main() {
  const first = await fetchHtml(`${BASE}/certification-status`);
  const total = Number(first.match(/Total\s+(\d+)/)?.[1] ?? 0);
  const codes = new Set<string>();
  for (let page = 1; page <= 40; page++) {
    const html = page === 1 ? first : await fetchHtml(`${BASE}/certification-status&page=${page}`);
    const before = codes.size;
    for (const m of html.matchAll(/certification-view&code=(\d+)/g)) codes.add(m[1]);
    if (codes.size === before) break; // 새 항목 없음 = 마지막 페이지 지나감
  }
  console.log(`[history] 목록 ${codes.size}건 (사이트 표기 Total ${total})`);

  const byNo = new Map<string, RawCert>();
  let n = 0;
  for (const code of codes) {
    n++;
    try {
      for (const r of parseRows(await fetchHtml(`${BASE}/certification-view&code=${code}`))) byNo.set(r.cert_no, r);
    } catch (err) {
      console.error(`[history] FAIL code=${code}:`, err instanceof Error ? err.message : err);
    }
    if (n % 25 === 0) console.log(`[history] ${n}/${codes.size} 상세, 인증번호 ${byNo.size}건`);
  }
  await mkdir(path.dirname(OUT), { recursive: true });
  const all = [...byNo.values()].sort((a, b) => a.cert_no.localeCompare(b.cert_no));
  await writeFile(OUT, JSON.stringify(all, null, 2), "utf8");
  console.log(`[history] 완료: 인증 ${all.length}건 → ${OUT}`);
}

main().catch((err) => {
  console.error("[history] 실패:", err);
  process.exit(1);
});
