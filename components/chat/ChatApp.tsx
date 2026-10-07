"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MSG_ERROR_HANDOFF,
  MSG_RATE_LIMITED,
  MSG_SOURCES_LABEL,
  QNA_URL,
  UI_CONSULT_BUTTON,
  UI_FOOTER_DISCLAIMER,
  UI_GREETING,
  UI_HEADER,
  UI_INPUT_PLACEHOLDER,
  UI_LOADING,
  UI_PRIVACY_HINT,
  UI_SEND,
  UI_SOURCE_LABEL,
  UI_SUGGESTIONS,
} from "@/lib/prompts/messages";
import { resolveClientSource } from "@/lib/channels";
import { readSse, type CertOptionDto } from "./parse-sse";

interface Msg {
  id: number;
  role: "user" | "bot";
  text: string;
  sources: string[];
  options: CertOptionDto[];
  pending: boolean;
  /** 이 답변을 유발한 고객 질문 (되묻기 버튼 클릭 시 previousQuestion 으로 전달) */
  asked: string;
}

const SESSION_KEY = "igsc_chat_session";
const SOURCE_KEY = "igsc_chat_source";
const MAX_LEN = 500;

/** 브라우저 세션(탭) 단위 id. storage가 막힌 환경(서드파티 iframe 등)에서는 메모리에만 둔다. */
function newSessionId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/** 백엔드가 답변 끝에 붙이는 "참고 자료: - URL" 블록은 링크 UI로 대체하므로 본문에서 뺀다. */
function stripSourceBlock(text: string): string {
  const re = new RegExp(`\\n*${MSG_SOURCES_LABEL}:\\n(?:- \\S+\\n?)+`);
  return text.replace(re, "\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function ChatApp() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const sessionIdRef = useRef("");
  const nextId = useRef(1);
  const endRef = useRef<HTMLDivElement>(null);

  /** 이 방문의 유입 채널: 링크의 ?src= (없으면 이전 페이지 주소로 짐작). 한 번 정하면 탭이 열려 있는 동안 유지한다. */
  const getSource = useCallback((): { source?: string; sourceDetail?: string } => {
    try {
      const saved = sessionStorage.getItem(SOURCE_KEY);
      if (saved !== null) {
        const p = JSON.parse(saved) as { source: string | null; detail: string | null };
        return { source: p.source ?? undefined, sourceDetail: p.detail ?? undefined };
      }
    } catch {
      /* 저장소를 못 쓰는 환경: 매번 다시 계산 */
    }
    const r = resolveClientSource(window.location.search, document.referrer);
    try {
      sessionStorage.setItem(SOURCE_KEY, JSON.stringify({ source: r?.source ?? null, detail: r?.source_detail ?? null }));
    } catch {
      /* 무시 */
    }
    return { source: r?.source ?? undefined, sourceDetail: r?.source_detail ?? undefined };
  }, []);

  const getSessionId = useCallback(() => {
    if (sessionIdRef.current) return sessionIdRef.current;
    let id = "";
    try {
      id = sessionStorage.getItem(SESSION_KEY) ?? "";
      if (!id) {
        id = newSessionId();
        sessionStorage.setItem(SESSION_KEY, id);
      }
    } catch {
      id = newSessionId();
    }
    sessionIdRef.current = id;
    return id;
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const send = useCallback(
    async (message: string, extra?: { certType?: string; previousQuestion?: string }) => {
      const text = message.trim();
      if (!text || busy) return;
      setBusy(true);
      setInput("");

      const userId = nextId.current++;
      const botId = nextId.current++;
      setMessages((prev) => [
        ...prev,
        { id: userId, role: "user", text, sources: [], options: [], pending: false, asked: "" },
        { id: botId, role: "bot", text: "", sources: [], options: [], pending: true, asked: extra?.previousQuestion ?? text },
      ]);
      const patch = (fn: (m: Msg) => Msg) => setMessages((prev) => prev.map((m) => (m.id === botId ? fn(m) : m)));

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text, sessionId: getSessionId(), ...getSource(), ...extra }),
        });
        if (res.status === 429) {
          patch((m) => ({ ...m, text: MSG_RATE_LIMITED }));
          return;
        }
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        for await (const ev of readSse(res.body)) {
          if (ev.event === "meta") {
            patch((m) => ({ ...m, sources: ev.data.sources, options: ev.data.options ?? [] }));
          } else if (ev.event === "delta") {
            patch((m) => ({ ...m, text: m.text + ev.data.text }));
          }
        }
        patch((m) => (m.text ? m : { ...m, text: MSG_ERROR_HANDOFF }));
      } catch (err) {
        console.error("[chat] 요청 실패:", err);
        patch((m) => ({ ...m, text: m.text || MSG_ERROR_HANDOFF }));
      } finally {
        patch((m) => ({ ...m, pending: false }));
        setBusy(false);
      }
    },
    [busy, getSessionId, getSource],
  );

  const started = messages.length > 0;
  const lastBotId = [...messages].reverse().find((m) => m.role === "bot")?.id;

  return (
    <div
      className="flex h-dvh min-w-[320px] flex-col bg-white text-slate-900"
      style={{ colorScheme: "light", fontFamily: '"Pretendard", "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", system-ui, sans-serif' }}
    >
      <header className="shrink-0 border-b border-slate-200 bg-teal-700 px-4 py-3 text-[14px] font-semibold leading-snug text-white">
        {UI_HEADER}
      </header>

      <main role="log" aria-live="polite" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4">
        <Bubble role="bot">{UI_GREETING}</Bubble>

        {!started && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            {UI_SUGGESTIONS.map(([label, question]) => (
              <button
                key={label}
                type="button"
                onClick={() => send(question)}
                className="min-h-[44px] rounded-xl border border-teal-700/30 bg-teal-50 px-3 py-2 text-[14px] font-medium text-teal-900 active:bg-teal-100"
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {messages.map((m) => {
          if (m.role === "user") {
            return (
              <Bubble key={m.id} role="user">
                {m.text}
              </Bubble>
            );
          }
          const body = stripSourceBlock(m.text);
          return (
            <div key={m.id} className="mt-3">
              <Bubble role="bot" noMargin>
                {body || (m.pending ? <span className="text-slate-500">{UI_LOADING}…</span> : "")}
              </Bubble>

              {!m.pending && (
                <div className="mt-2 max-w-[92%] space-y-2">
                  {m.options.length > 0 && m.id === lastBotId && (
                    <div className="flex flex-wrap gap-2" role="group" aria-label="인증 종류 선택">
                      {m.options.map((o) => (
                        <button
                          key={o.certType}
                          type="button"
                          disabled={busy}
                          onClick={() => send(o.label, { certType: o.certType, previousQuestion: m.asked })}
                          className="min-h-[40px] rounded-full border border-teal-700 bg-white px-3 py-1.5 text-[13px] font-medium text-teal-800 active:bg-teal-50 disabled:opacity-50"
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                  )}

                  {m.sources.length > 0 && (
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-slate-600">
                      {m.sources.map((url, i) => (
                        <a
                          key={url}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={url}
                          className="font-medium text-teal-800 underline underline-offset-2"
                        >
                          {UI_SOURCE_LABEL}
                          {m.sources.length > 1 ? ` ${i + 1}` : ""} ↗
                        </a>
                      ))}
                    </p>
                  )}

                  <a
                    href={QNA_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-[40px] items-center rounded-lg border border-slate-300 bg-white px-3 text-[13px] font-medium text-slate-800 active:bg-slate-50"
                  >
                    {UI_CONSULT_BUTTON} ↗
                  </a>
                </div>
              )}
            </div>
          );
        })}
        <div ref={endRef} />
      </main>

      <footer className="shrink-0 border-t border-slate-200 bg-white pb-[max(env(safe-area-inset-bottom),0px)]">
        <form
          className="flex gap-2 px-3 pt-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            maxLength={MAX_LEN}
            placeholder={UI_INPUT_PLACEHOLDER}
            aria-label={UI_INPUT_PLACEHOLDER}
            autoComplete="off"
            enterKeyHint="send"
            disabled={busy}
            className="min-h-[44px] min-w-0 flex-1 rounded-xl border border-slate-300 px-3 text-[16px] outline-none focus:border-teal-700 focus:ring-2 focus:ring-teal-700/20 disabled:bg-slate-50"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="min-h-[44px] shrink-0 rounded-xl bg-teal-700 px-4 text-[14px] font-semibold text-white active:bg-teal-800 disabled:opacity-40"
          >
            {UI_SEND}
          </button>
        </form>
        <p className="px-3 pb-2 pt-1.5 text-[11px] leading-snug text-slate-500">
          {UI_FOOTER_DISCLAIMER} {UI_PRIVACY_HINT}
        </p>
      </footer>
    </div>
  );
}

function Bubble({ role, children, noMargin }: { role: "user" | "bot"; children: React.ReactNode; noMargin?: boolean }) {
  const isUser = role === "user";
  return (
    <div className={`${noMargin ? "" : "mt-3"} flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[88%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed ${
          isUser ? "rounded-br-md bg-teal-700 text-white" : "rounded-bl-md bg-slate-100 text-slate-900"
        }`}
      >
        {children}
      </div>
    </div>
  );
}
