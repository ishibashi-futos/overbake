// compose 実行用の dev serverサンプルコードです
// @ts-ignore
const server = Bun.serve({
  // port を明示しない場合、Bun は PORT / BUN_PORT / --port などを参照する
  fetch(req: any) {
    console.log(new Date());
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      return Response.json({ status: "ok" });
    }

    return new Response(`Hello from Bun in ${server.port}\n`, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  },
});

console.log(`Server running at http://localhost:${server.port}`);
