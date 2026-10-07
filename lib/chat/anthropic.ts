import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;
export const getAnthropic = () => (client ??= new Anthropic());

export const CLASSIFY_MODEL = process.env.CLASSIFY_MODEL ?? "claude-haiku-4-5-20251001";
export const ANSWER_MODEL = process.env.ANSWER_MODEL ?? "claude-sonnet-5-5";
