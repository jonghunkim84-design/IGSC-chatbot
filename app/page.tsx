import { redirect } from "next/navigation";

/** 루트 접속은 챗봇 화면으로 보낸다. (고객사 사이트에는 /widget.js 로 삽입) */
export default function Home() {
  redirect("/chat");
}
