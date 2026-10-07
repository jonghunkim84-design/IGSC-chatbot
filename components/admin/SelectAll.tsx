"use client";

/** 같은 form 안의 name="ids" 체크박스를 한꺼번에 선택/해제한다. */
export function SelectAll() {
  return (
    <input
      type="checkbox"
      aria-label="현재 페이지 전체 선택"
      className="h-4 w-4"
      onChange={(e) => {
        const form = e.currentTarget.form;
        form?.querySelectorAll<HTMLInputElement>('input[name="ids"]:not(:disabled)').forEach((c) => {
          c.checked = e.currentTarget.checked;
        });
      }}
    />
  );
}
