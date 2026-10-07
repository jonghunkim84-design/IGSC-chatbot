/** 테스트용 문서 파일을 코드로 만든다 (ZIP 기반 OOXML). 외부 도구 없이 docx/pptx 를 재현하기 위함. */

function crc32(buf: Buffer): number {
  let c: number;
  let crc = 0xffffffff;
  for (const b of buf) {
    c = (crc ^ b) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** 압축 없는(stored) ZIP */
export function zip(files: { name: string; data: string | Buffer }[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const data = typeof f.data === "string" ? Buffer.from(f.data, "utf8") : f.data;
    const name = Buffer.from(f.name);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 파일명
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

export type DocxItem = { h1: string } | { h2: string } | { p: string } | { table: string[][] };

export function buildDocx(items: DocxItem[]): Buffer {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const body = items
    .map((it) => {
      if ("h1" in it) return `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${esc(it.h1)}</w:t></w:r></w:p>`;
      if ("h2" in it) return `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>${esc(it.h2)}</w:t></w:r></w:p>`;
      if ("p" in it) return `<w:p><w:r><w:t xml:space="preserve">${esc(it.p)}</w:t></w:r></w:p>`;
      const rows = it.table
        .map((r) => `<w:tr>${r.map((c) => `<w:tc><w:p><w:r><w:t>${esc(c)}</w:t></w:r></w:p></w:tc>`).join("")}</w:tr>`)
        .join("");
      return `<w:tbl><w:tblPr/><w:tblGrid/>${rows}</w:tbl>`;
    })
    .join("");
  const styles = `${XML}<w:styles ${W}><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style></w:styles>`;
  return zip([
    { name: "[Content_Types].xml", data: `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>` },
    { name: "_rels/.rels", data: `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>` },
    { name: "word/_rels/document.xml.rels", data: `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "word/styles.xml", data: styles },
    { name: "word/document.xml", data: `${XML}<w:document ${W}><w:body>${body}</w:body></w:document>` },
  ]);
}

export interface PptxSlide {
  title?: string;
  paras?: string[];
  table?: string[][];
}

/** order: 실제 슬라이드 순서(파일 번호 배열). 예: [2, 1] 이면 slide2.xml 이 첫 번째 슬라이드 */
export function buildPptx(slides: PptxSlide[], order?: number[]): Buffer {
  const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const sp = (paras: string[], ph?: string) =>
    `<p:sp><p:nvSpPr><p:cNvPr id="1" name="s"/><p:cNvSpPr/><p:nvPr>${ph ? `<p:ph type="${ph}"/>` : ""}</p:nvPr></p:nvSpPr><p:txBody><a:bodyPr/>${paras.map((t) => `<a:p><a:r><a:t>${esc(t)}</a:t></a:r></a:p>`).join("")}</p:txBody></p:sp>`;
  const slideXml = (s: PptxSlide) => {
    const tbl = s.table
      ? `<p:graphicFrame><a:graphic><a:graphicData><a:tbl>${s.table.map((r) => `<a:tr>${r.map((c) => `<a:tc><a:txBody><a:p><a:r><a:t>${esc(c)}</a:t></a:r></a:p></a:txBody></a:tc>`).join("")}</a:tr>`).join("")}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`
      : "";
    return `${XML}<p:sld ${A}><p:cSld><p:spTree>${s.title ? sp([s.title], "title") : ""}${s.paras ? sp(s.paras) : ""}${tbl}</p:spTree></p:cSld></p:sld>`;
  };
  const seq = order ?? slides.map((_, i) => i + 1);
  return zip([
    { name: "[Content_Types].xml", data: `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>` },
    { name: "_rels/.rels", data: `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>` },
    { name: "ppt/presentation.xml", data: `${XML}<p:presentation ${A}><p:sldIdLst>${seq.map((n, i) => `<p:sldId id="${256 + i}" r:id="rId${n}"/>`).join("")}</p:sldIdLst></p:presentation>` },
    { name: "ppt/_rels/presentation.xml.rels", data: `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${slides.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join("")}</Relationships>` },
    ...slides.map((s, i) => ({ name: `ppt/slides/slide${i + 1}.xml`, data: slideXml(s) })),
  ]);
}
