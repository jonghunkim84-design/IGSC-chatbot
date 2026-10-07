"use client";

import { btnGhost } from "@/components/admin/ui";

/** 같은 form 안에서 체크된 name="ids" 항목을 삭제 액션으로 보낸다. 확인 창을 한 번 거친다. */
export function DeleteSelectedButton({ action }: { action: (formData: FormData) => void | Promise<void> }) {
  return (
    <button
      type="submit"
      formAction={action}
      className={`${btnGhost} border-red-300 text-red-700 hover:bg-red-50`}
      onClick={(e) => {
        const n = e.currentTarget.form?.querySelectorAll('input[name="ids"]:checked').length ?? 0;
        if (n === 0) return; // 서버가 '먼저 선택해 주세요' 안내를 보여준다
        if (!window.confirm(`선택한 ${n}건을 삭제할까요?\n초안만 삭제되며(승인된 FAQ는 제외) 되돌릴 수 없습니다.`)) e.preventDefault();
      }}
    >
      선택 항목 삭제
    </button>
  );
}
