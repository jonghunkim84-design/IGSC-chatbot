/**
 * 공통(common) FAQ 보충: "비건 인증 절차랑 필요 서류"처럼 인증 이름이 들어간 질문에서
 * 선택기가 그 인증 전용 항목에만 쏠려도, 모든 인증에 적용되는 공통 항목이 함께 근거로 쓰이는지 확인한다.
 */
import { describe, expect, it, vi } from "vitest";
import { createSearchFaq, type SearchDeps } from "@/lib/search";
import { invalidateFaqCache } from "@/lib/search/faq-cache";
import { chat, fixtureSearch } from "./helpers";
import type { FaqMatch } from "@/lib/search";

const faqs: FaqMatch[] = [
  { id: "a1", question: "비건 인증 신청 시 필요한 서류는 무엇인가요?", answer: "신청서와 제품 목록이 필요합니다.", source_url: null, cert_type: "vegan", category: "document", needs_input: false },
  { id: "a2", question: "인증 절차는 어떻게 진행되나요?", answer: "신청서 접수, 견적서 송부, 서류 심사, 현장심사, 인증위원회, 인증서 발급 순서로 진행됩니다.", source_url: null, cert_type: "common", category: "procedure", needs_input: false },
  { id: "a3", question: "유기농 인증 대상은 무엇인가요?", answer: "유기농 제품입니다.", source_url: null, cert_type: "organic", category: "scope", needs_input: false },
];

const build = (select: SearchDeps["select"]) => {
  invalidateFaqCache();
  return createSearchFaq({
    loadIndex: async () => faqs.map((f) => ({ id: f.id, question: f.question, variants: [], cert_type: f.cert_type })),
    loadAnswers: async (ids) => ids.map((id) => faqs.find((f) => f.id === id)!),
    select,
  });
};

describe("공통 FAQ 보충 (stub)", () => {
  it("전용 항목만 골라졌으면 공통 목록에서 한 번 더 골라 뒤에 붙인다", async () => {
    const select = vi.fn<SearchDeps["select"]>(async (_q, list, o) => (o?.commonOnly ? [list.findIndex((f) => f.id === "a2")] : [list.findIndex((f) => f.id === "a1")]));
    const r = await build(select)("비건 인증 절차랑 필요 서류 알려주세요");
    expect(r.map((m) => m.id)).toEqual(["a1", "a2"]);
    expect(select).toHaveBeenCalledTimes(2);
    expect(select.mock.calls[1][1].every((f) => f.cert_type === "common")).toBe(true);
  });

  it("공통 보충 선택은 첫 선택이 끝나기 전에 시작된다 (동시 실행)", async () => {
    const events: string[] = [];
    const select = vi.fn<SearchDeps["select"]>(async (_q, list, o) => {
      events.push(o?.commonOnly ? "common:start" : "main:start");
      await new Promise((r) => setTimeout(r, o?.commonOnly ? 10 : 40));
      events.push(o?.commonOnly ? "common:end" : "main:end");
      return o?.commonOnly ? [list.findIndex((f) => f.id === "a2")] : [list.findIndex((f) => f.id === "a1")];
    });
    const r = await build(select)("비건 인증 절차랑 필요 서류 알려주세요");
    expect(events.indexOf("common:start")).toBeLessThan(events.indexOf("main:end"));
    expect(r.map((m) => m.id)).toEqual(["a1", "a2"]);
  });

  it("공통 보충 선택이 실패해도 첫 선택 결과로 계속한다", async () => {
    const select = vi.fn<SearchDeps["select"]>(async (_q, list, o) => {
      if (o?.commonOnly) throw new Error("api down");
      return [list.findIndex((f) => f.id === "a1")];
    });
    const r = await build(select)("비건 인증 서류 알려주세요");
    expect(r.map((m) => m.id)).toEqual(["a1"]);
  });

  it("처음부터 공통 항목만 골라졌으면 두 번째 선택을 하지 않는다", async () => {
    const select = vi.fn<SearchDeps["select"]>(async (_q, list) => [list.findIndex((f) => f.id === "a2")]);
    const r = await build(select)("인증 절차가 어떻게 되나요?");
    expect(r.map((m) => m.id)).toEqual(["a2"]);
  });

  it("아무것도 못 골랐으면(FAQ에 없는 인증일 수 있음) 공통 항목으로 채우지 않는다", async () => {
    const select = vi.fn<SearchDeps["select"]>(async () => []);
    const r = await build(select)("할랄 인증 서류 알려주세요");
    expect(r).toEqual([]); // 두 번째(공통) 선택이 동시에 실행되더라도 첫 선택이 비면 공통 항목으로 채우지 않는다
  });

  it("같은 항목이 두 번 들어가지 않는다", async () => {
    const select = vi.fn<SearchDeps["select"]>(async (_q, list) => [list.findIndex((f) => f.id === "a1"), list.findIndex((f) => f.id === "a2")].filter((i) => i >= 0));
    const r = await build(select)("비건 인증 절차랑 필요 서류 알려주세요");
    expect(r.map((m) => m.id)).toEqual(["a1", "a2"]);
  });
});

describe("공통 FAQ 보충 — 실제 모델", () => {
  it("'비건 인증 절차랑 필요 서류' → 전용 서류 항목 + 공통 절차 항목을 함께 근거로 답한다", async () => {
    const r = await chat("비건 인증 절차랑 필요 서류 알려주세요", { search: fixtureSearch(faqs) });
    expect(r.route).toBe("answered");
    expect(r.text).toContain("신청서와 제품 목록");
    expect(r.text).toMatch(/견적서|서류 심사|현장심사|인증위원회/); // 공통 절차 FAQ 내용
    expect(r.text).not.toMatch(/전체 인증 절차는 담당자가 확인/);
  }, 60000);
});

