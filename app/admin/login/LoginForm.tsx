"use client";

import { useState } from "react";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? "요청에 실패했습니다.");
      setState("sent");
    } catch (err) {
      setState("error");
      setMessage(err instanceof Error ? err.message : "요청에 실패했습니다.");
    }
  }

  if (state === "sent") {
    return (
      <p role="status" className="mt-5 rounded-lg bg-teal-50 px-3 py-3 text-sm leading-relaxed text-teal-900">
        등록된 주소라면 로그인 링크를 보냈습니다. 메일함을 확인하고, <b>이 브라우저에서</b> 링크를 열어 주세요.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="mt-5 space-y-3">
      <label className="block text-sm font-medium text-slate-800" htmlFor="email">
        이메일
      </label>
      <input
        id="email"
        type="email"
        required
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-[16px] outline-none focus:border-teal-700 focus:ring-2 focus:ring-teal-700/20"
      />
      {state === "error" && (
        <p role="alert" className="text-sm text-red-700">
          {message}
        </p>
      )}
      <button
        type="submit"
        disabled={state === "sending"}
        className="w-full rounded-lg bg-teal-700 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
      >
        {state === "sending" ? "보내는 중…" : "로그인 링크 받기"}
      </button>
    </form>
  );
}
