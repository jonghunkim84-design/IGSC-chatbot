"use client";

import { useState } from "react";
import { CHANNELS, buildChannelLink, sanitizeDetail } from "@/lib/channels";
import { inputCls } from "@/components/admin/ui";

/** 채널별 챗봇 링크. 캠페인 이름(선택)을 넣으면 링크 뒤에 &c=이름 이 붙는다. */
export function ChannelLinks({ origin }: { origin: string }) {
  const [campaign, setCampaign] = useState("");
  const [copied, setCopied] = useState("");
  const clean = sanitizeDetail(campaign);
  const invalid = campaign.trim() !== "" && !clean;

  async function copy(code: string, url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(code);
      setTimeout(() => setCopied((c) => (c === code ? "" : c)), 1500);
    } catch {
      window.prompt("아래 링크를 복사하세요 (Ctrl+C)", url);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-800">채널별 링크 만들기</h3>
      <p className="mt-1 text-xs text-slate-500">각 채널에 아래 링크를 그대로 걸어 두면, 그 링크로 들어온 고객의 질문이 해당 채널로 집계됩니다.</p>
      <label className="mt-3 block text-xs font-medium text-slate-600">
        캠페인 이름 (선택) — 같은 채널 안에서 게시물·담당자를 구분하고 싶을 때. 소문자 영문·숫자·-_ 만, 40자 이내
        <input value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="예: story-1010, kim" className={`${inputCls} mt-1 max-w-sm`} />
      </label>
      {invalid && <p className="mt-1 text-xs text-amber-700">캠페인 이름은 소문자 영문·숫자·-_ 만 쓸 수 있어 지금은 링크에 붙지 않습니다.</p>}
      <ul className="mt-3 space-y-2">
        {CHANNELS.map((c) => {
          const url = buildChannelLink(origin, c.code, clean);
          return (
            <li key={c.code} className="grid gap-1 sm:grid-cols-[10rem_1fr_auto] sm:items-center sm:gap-3">
              <span className="text-sm font-medium text-slate-800">{c.label}</span>
              <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label={`${c.label} 링크`} className={`${inputCls} font-mono text-xs`} />
              <button type="button" onClick={() => copy(c.code, url)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50">
                {copied === c.code ? "복사됨" : "복사"}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
