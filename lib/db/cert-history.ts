import "server-only";
import { createServerClient } from "./server";
import type { CertHistory } from "./types";

/** 공개 동의(company_public)된 인증 이력만 반환. */
export async function listPublicCertHistory(certType?: string): Promise<CertHistory[]> {
  let q = createServerClient().from("cert_history").select("*").eq("company_public", true);
  if (certType) q = q.eq("cert_type", certType);
  const { data, error } = await q.order("year", { ascending: false });
  if (error) throw error;
  return data as CertHistory[];
}
