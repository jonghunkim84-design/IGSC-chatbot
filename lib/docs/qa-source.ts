import "server-only";
import { extensionOf } from "@/lib/admin/documents";
import { createServerClient } from "@/lib/db/server";
import { DOC_BUCKET } from "@/lib/db/admin-documents";
import { extractBlocks } from "@/lib/extract";
import { parseQaPairs, type QaPair } from "./qa-pairs";

/** 저장된 원본 파일에서 질문·답변 쌍을 꺼낸다 (추출 조각이 아니라 원문 블록을 읽는다: 조각 겹침으로 답변이 중복되지 않게). */
export async function loadQaPairs(doc: { storage_path: string }): Promise<QaPair[]> {
  const { data: blob, error } = await createServerClient().storage.from(DOC_BUCKET).download(doc.storage_path);
  if (error || !blob) throw new Error("저장된 파일을 읽지 못했습니다.");
  const blocks = await extractBlocks(new Uint8Array(await blob.arrayBuffer()), extensionOf(doc.storage_path));
  return parseQaPairs(blocks);
}
