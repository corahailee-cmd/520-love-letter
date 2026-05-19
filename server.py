#!/usr/bin/env python3
"""本地开发服务器：托管静态文件 + 转发豆包 API 请求"""

import http.server
import json
import os
import urllib.request
import urllib.error
from http.server import HTTPServer

PORT = 8080
ARK_API_KEY = os.environ.get("ARK_API_KEY", "")
ARK_URL = "https://ark.cn-beijing.volces.com/api/v3/chat/completions"

PROMPT = """仔细观察这张照片的主色调和整体氛围，返回以下JSON（只返回JSON，不要其他文字）：
{
  "colorNameZh": "2-3个汉字的诗意中文色名，如「琥珀棕」「霜青蓝」「暮橘红」",
  "colorNameEn": "对应英文色名，2-3个单词，优雅诗意",
  "hex": "照片主色调的十六进制色码",
  "letter": "根据照片氛围写一句有意境的中文情话，温柔而不腻，参考风格：「你就像这只小鹿抬头的瞬间——不是刻意的，只是午后的光恰好落在你身上，我就再也移不开眼了。」"
}"""


class Handler(http.server.SimpleHTTPRequestHandler):

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self):
        if self.path != "/api/generate":
            self.send_response(404)
            self.end_headers()
            return

        if not ARK_API_KEY:
            self._error(500, "未设置 ARK_API_KEY 环境变量")
            return

        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length))
        image_b64 = body.get("image", "")
        if not image_b64:
            self._error(400, "缺少 image 字段")
            return

        payload = json.dumps({
            "model": "doubao-1-5-vision-pro-32k-250115",
            "max_tokens": 800,
            "messages": [{
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"}},
                    {"type": "text", "text": PROMPT}
                ]
            }]
        }).encode()

        req = urllib.request.Request(
            ARK_URL,
            data=payload,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {ARK_API_KEY}",
            },
            method="POST"
        )

        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = resp.read()
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(data)
        except urllib.error.HTTPError as e:
            self._error(502, f"上游错误 {e.code}: {e.read().decode()}")
        except Exception as e:
            self._error(502, str(e))

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _error(self, code, msg):
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.end_headers()
        self.wfile.write(msg.encode())

    def log_message(self, fmt, *args):
        print(f"  {self.address_string()} - {fmt % args}")


if __name__ == "__main__":
    if not ARK_API_KEY:
        print("⚠️  警告：未检测到 ARK_API_KEY，API 调用会失败")
        print("   请先运行：export ARK_API_KEY=你的key\n")
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    server = HTTPServer(("", PORT), Handler)
    print(f"✅ 服务已启动：http://localhost:{PORT}")
    print("   按 Ctrl+C 停止\n")
    server.serve_forever()
