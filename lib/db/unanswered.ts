import "server-only";
import { createServerClient } from "./server";
import type { Unanswered } from "./types";

export async function insertUnanswered(
  question: string,
  chatLogId?: string,
): Promise<Unanswered> {
  const { data, error } = await createServerClient()
    .from("unanswered")
    .insert({ question, chat_log_id: chatLogId ?? null })
    .select()
    .single();
  if (error) throw error;
  return data as Unanswered;
}

export async function listOpenUnanswered(): Promise<Unanswered[]> {
  const { data, error } = await createServerClient()
    .from("unanswered")
    .select("*")
    .eq("resolved", false)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data as Unanswered[];
}

export async function resolveUnanswered(id: string): Promise<void> {
  const { error } = await createServerClient()
    .from("unanswered")
    .update({ resolved: true })
    .eq("id", id);
  if (error) throw error;
}
