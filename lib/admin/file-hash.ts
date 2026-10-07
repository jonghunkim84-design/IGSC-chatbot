/** 브라우저에서 파일 내용의 SHA-256(소문자 16진수)을 계산한다. 서버가 같은 값을 다시 계산해 확인한다. */
export async function sha256File(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
