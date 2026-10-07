import { strFromU8, unzipSync } from "fflate";
import { cleanText, unescapeXml } from "./text";
import { ExtractError, type Block } from "./types";

const paragraphsOf = (xml: string): string[] =>
  [...xml.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)]
    .map((m) =>
      unescapeXml(
        m[1]
          .replace(/<a:br\s*\/?>/g, "\n")
          .replace(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g, "$1\u0001")
          .replace(/<[^>]+>/g, ""),
      ).replace(/\u0001/g, ""),
    )
    .map((t) => cleanText(t))
    .filter(Boolean);

/** 슬라이드 순서: presentation.xml 의 sldId 순서를 관계 파일로 slideN.xml 에 연결한다 (파일 번호와 실제 순서는 다를 수 있다). */
function slideOrder(files: Record<string, Uint8Array>): string[] {
  const pres = files["ppt/presentation.xml"];
  const rels = files["ppt/_rels/presentation.xml.rels"];
  const byNumber = Object.keys(files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]));
  if (!pres || !rels) return byNumber;
  const relMap = new Map<string, string>();
  for (const m of strFromU8(rels).matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[0])?.[1];
    const target = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
    if (id && target) relMap.set(id, target.startsWith("/") ? target.slice(1) : `ppt/${target.replace(/^\.\//, "")}`);
  }
  const ordered = [...strFromU8(pres).matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)]
    .map((m) => relMap.get(m[1]))
    .filter((p): p is string => !!p && p in files);
  return ordered.length ? ordered : byNumber;
}

/** 슬라이드별 블록. 슬라이드 번호가 page_no, 제목 상자는 section_title, 표는 통째로 table 블록. */
export function extractPptx(bytes: Uint8Array): Block[] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (f) => /^ppt\/(slides\/slide\d+\.xml|presentation\.xml|_rels\/presentation\.xml\.rels)$/.test(f.name) });
  } catch {
    throw new ExtractError("corrupt");
  }
  const order = slideOrder(files);
  if (order.length === 0) throw new ExtractError("corrupt");

  const blocks: Block[] = [];
  order.forEach((name, i) => {
    const page = i + 1;
    const xml = strFromU8(files[name]);
    for (const m of xml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>|<p:graphicFrame\b[\s\S]*?<\/p:graphicFrame>/g)) {
      const shape = m[0];
      if (shape.startsWith("<p:graphicFrame")) {
        const rows = [...shape.matchAll(/<a:tr\b[\s\S]*?<\/a:tr>/g)]
          .map((tr) => [...tr[0].matchAll(/<a:tc\b[\s\S]*?<\/a:tc>/g)].map((tc) => paragraphsOf(tc[0]).join(" ")))
          .filter((r) => r.some(Boolean));
        if (rows.length) blocks.push({ kind: "table", rows, page });
        continue;
      }
      const paras = paragraphsOf(shape);
      if (paras.length === 0) continue;
      const isTitle = /<p:ph\b[^>]*\btype="(?:title|ctrTitle)"/.test(shape);
      if (isTitle) blocks.push({ kind: "heading", text: paras.join(" "), level: 1, page });
      else for (const p of paras) blocks.push({ kind: "para", text: p, page });
    }
  });
  return blocks;
}
