"""교육 자료(Markdown) → PDF. Chrome(headless)로 인쇄한다.
사용: python docs/education/build_pdf.py        (필요: pip install markdown, Chrome 또는 Edge)
"""
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile

import markdown

HERE = pathlib.Path(__file__).parent
BROWSERS = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
]
DOCS = [  # (docs/ 기준 md 경로, PDF 이름, 제목) — PDF 는 md 와 같은 폴더에 만든다
    ("education/교육 매뉴얼.md", "IGSC 챗봇 사용자 교육 매뉴얼.pdf", "IGSC 인증 문의 챗봇 · 사용자 교육 매뉴얼"),
    ("education/고객 확인 사항.md", "IGSC 챗봇 고객 확인 사항.pdf", "IGSC 인증 문의 챗봇 · 고객 확인·결정 사항"),
    ("handover/시스템 설계서_final.md", "IGSC 챗봇 시스템 설계서_final.pdf", "IGSC 인증 문의 챗봇 · 시스템 설계서 (final)"),
    ("handover/운영자 매뉴얼_final.md", "IGSC 챗봇 운영자 매뉴얼_final.pdf", "IGSC 인증 문의 챗봇 · 운영자 매뉴얼 (final)"),
    ("handover/인수 가이드 (고객용)_final.md", "IGSC 챗봇 인수 매뉴얼 (고객용)_final.pdf", "IGSC 인증 문의 챗봇 · 시스템 인수 가이드 (고객용, final)"),
    ("handover/인계 가이드 (개발 담당용)_final.md", "IGSC 챗봇 인계 매뉴얼 (개발 담당용)_final.pdf", "IGSC 인증 문의 챗봇 · 시스템 인계 가이드 (개발 담당용, final)"),
]

CSS = """
@page { size: A4; margin: 18mm 15mm 18mm 15mm; }
* { box-sizing: border-box; }
body { font-family: 'Malgun Gothic','맑은 고딕',sans-serif; font-size: 10pt; line-height: 1.55; color: #1e293b; }
h1 { font-size: 21pt; color: #0f766e; border-bottom: 3px solid #0f766e; padding-bottom: 6px; margin: 0 0 10px; }
h2 { font-size: 14.5pt; color: #fff; background: #0f766e; padding: 5px 10px; border-radius: 4px; margin: 22px 0 8px; break-after: avoid; }
h3 { font-size: 11.5pt; color: #0f766e; border-left: 4px solid #0f766e; padding-left: 8px; margin: 16px 0 6px; break-after: avoid; }
p, li { orphans: 3; widows: 3; }
ul, ol { padding-left: 20px; margin: 4px 0 8px; }
li { margin: 2px 0; }
blockquote { margin: 8px 0; padding: 7px 12px; background: #f0fdfa; border-left: 4px solid #14b8a6; color: #134e4a; }
blockquote p { margin: 2px 0; }
code { font-family: Consolas,'Malgun Gothic',monospace; background: #f1f5f9; padding: 0 3px; border-radius: 3px; font-size: 9pt; }
pre { background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px 10px; font-size: 9pt; white-space: pre-wrap; break-inside: avoid; }
pre code { background: none; padding: 0; }
table { border-collapse: collapse; width: 100%; margin: 6px 0 12px; font-size: 9pt; }
th { background: #e2f3f1; color: #134e4a; text-align: left; border: 1px solid #94a3b8; padding: 4px 6px; }
td { border: 1px solid #cbd5e1; padding: 4px 6px; vertical-align: top; }
tr { break-inside: avoid; }
thead { display: table-header-group; }
hr { border: 0; border-top: 1px solid #cbd5e1; margin: 14px 0; }
strong { color: #0f172a; }
table.decide th:last-child { width: 22%; }
table.decide td:last-child { height: 38px; }
.cover-meta { color: #64748b; font-size: 9pt; }
"""


def find_browser():
    for b in BROWSERS:
        if pathlib.Path(b).exists():
            return b
    sys.exit("Chrome 또는 Edge 를 찾지 못했습니다.")


def render(md_name, pdf_name, title):
    md_path = HERE.parent / md_name
    text = md_path.read_text(encoding="utf-8").replace("- [ ] ", "- ☐ ")  # 체크 칸
    body = markdown.markdown(text, extensions=["tables", "fenced_code", "sane_lists"])
    # '결정 내용' 열이 있는 표는 손으로 적을 수 있게 마지막 열 너비를 확보
    body = re.sub(r"<table>(?=\s*<thead>(?:(?!</thead>).)*결정 내용)", "<table class='decide'>", body, flags=re.S)
    html = f"<!doctype html><html lang='ko'><head><meta charset='utf-8'><title>{title}</title><style>{CSS}</style></head><body>{body}</body></html>"
    with tempfile.TemporaryDirectory() as tmp:
        src = pathlib.Path(tmp) / "doc.html"
        src.write_text(html, encoding="utf-8")
        out = md_path.parent / pdf_name
        tmp_pdf = pathlib.Path(tmp) / "out.pdf"
        subprocess.run(
            [
                find_browser(),
                "--headless=new",
                "--disable-gpu",
                "--no-pdf-header-footer",
                f"--print-to-pdf={tmp_pdf}",
                src.as_uri(),
            ],
            check=True,
            capture_output=True,
            timeout=120,
        )
        if not tmp_pdf.exists() or tmp_pdf.stat().st_size < 1000:
            sys.exit(f"PDF 생성 실패: {pdf_name}")
        try:
            shutil.copyfile(tmp_pdf, out)  # 열려 있는(잠긴) 파일이면 PermissionError
        except PermissionError:
            alt = out.with_name(out.stem + " (최신).pdf")
            shutil.copyfile(tmp_pdf, alt)
            print(f"경고: '{out.name}' 이(가) 다른 프로그램에서 열려 있어 덮어쓰지 못했습니다. 최신본은 '{alt.name}' 로 저장했습니다.")
            out = alt
    print("생성:", out)


if __name__ == "__main__":
    only = sys.argv[1:]  # 예: python build_pdf.py handover  (폴더 이름으로 일부만 만들기)
    for d in DOCS:
        if not only or any(d[0].startswith(o) for o in only):
            render(*d)
