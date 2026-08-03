## Banyan 本地集成接口指南

面向：本地集成插件开发者（例如文字处理器、AI 辅助工具）。Banyan 通过本地 HTTP 服务与外部进程交互，不需要公网网络。

### 通用说明

- 路由前缀：所有 Banyan 接口均注册在 `/banyan/*`。
- 方法与编码：各路由均为 `POST`，请求体 `application/json`；响应为 JSON。
- 响应格式：`{ ok: true, data }` 或 `{ ok: false, error: { code, message } }`。取消对话框等预期行为也返回 200，但 `ok: false`、`code: "cancelled"`。
- 状态码：通常为 `200`（成功或业务级取消）、`400`（参数/内容类型错误）、`403`（鉴权失败）、`413`（请求体过大）、`429`（速率限制）、`500`（内部异常）。
- 端口说明：端口由 Zotero HTTP Server 统一管理，不再由 Banyan 插件首选项单独配置。
- 数据契约：详见 `typings/server.d.ts` 与 `typings/style.d.ts`。

### 请求头（Headers）

所有请求均需携带以下 HTTP 头：

| 头名称                   | 必须              | 说明                                                                                                      |
| ------------------------ | ----------------- | --------------------------------------------------------------------------------------------------------- |
| `Content-Type`           | 是                | 固定为 `application/json`。                                                                               |
| `Zotero-Allowed-Request` | 是（除 `/hello`） | 固定为 `1`。确保浏览器请求必须经过 CORS 预检，也是原生客户端协议标记。                                    |
| `X-Banyan-Client`        | 是（除 `/hello`） | 客户端标识名，用于鉴权、提示与速率限制。仅允许字母、数字、空格、`.`、`:`、`@`、`/`、`-`，截断至 80 字符。 |

### CORS 与预检（Preflight）

Banyan 已为所有端点启用 CORS 支持。服务端响应会自动附加以下头：

- `Access-Control-Allow-Origin`：回显请求的 `Origin`。
- `Access-Control-Allow-Methods`：`POST, OPTIONS`。
- `Access-Control-Allow-Headers`：`Content-Type, Zotero-Allowed-Request, X-Banyan-Client`。
- `Access-Control-Max-Age`：`600`（10 分钟）。
- `Vary`：`Origin`。

浏览器客户端跨域请求时，浏览器会自动发送 `OPTIONS` 预检请求，Banyan 已正确处理，无需额外配置。

### 鉴权流程

除 `/banyan/hello` 为公开端点外，所有端点均需鉴权。鉴权按以下优先级进行：

1. **速率限制**：按 `Origin + Path` 或 `X-Banyan-Client + Path` 计数，每 10 秒窗口最多 80 次请求。超限返回 `429`。
2. **公共 Header 检查**：必须同时提供 `Zotero-Allowed-Request: 1` 和非空 `X-Banyan-Client`，否则返回 `403`。
3. **无 Origin 的原生客户端**：仅允许内置白名单中的 `Banyan for Agent`、`Banyan for Word VBA`、`Banyan for WPS`，无需 Token 或用户配对。
4. **有 Origin 的浏览器客户端**：
   - `Origin: null` → 返回 `403`。
   - Origin 不可配对（非 `localhost`/IP/域名格式）→ 返回 `403`。
   - Origin 已在信任列表 → 放行，并更新最后访问时间。
   - Origin 可配对但未信任 → Zotero 弹出确认对话框，用户同意后加入信任列表并放行；拒绝则返回 `403`，且同一 Origin 60 秒内不再弹窗。

集成应优先连接 Zotero HTTP Server 的标准端口 `23119`；仅在连接层失败时，回退到调试构建端口 `23124`。收到 HTTP 响应后不得因状态码或业务错误重放请求。需要使用其他端口时，应由客户端自身提供显式设置，不再通过共享临时文件发现端口或令牌。

### 快速示例

以下示例用于具有正常 HTTP(S) Origin 的浏览器集成。首次请求会触发 Zotero 的 Origin 授权提示。无 Origin 的原生集成必须使用前述内置客户端名。

```ts
async function addOrEditCitation(base: string) {
  const payload = {
    style: { id: "your-style-id", title: "Your Style" },
    source: {
      citationType: "in-text",
      cites: [{ item: { id: 1, key: "ABCD1234" } }],
      uncited: [],
    },
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Zotero-Allowed-Request": "1",
    "X-Banyan-Client": "YourIntegrationName/1.0",
  };

  const res = await fetch(`${base}/banyan/citation`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  const body = await res.json();
  if (!body.ok) {
    if (body.error?.code === "cancelled") {
      return;
    }
    throw new Error(body.error?.message || "Unknown error");
  }
  return body.data;
}
```

### 路由一览

- `/banyan/hello`：健康检查。
- `/banyan/showInLibrary`：在 Zotero 主界面定位条目。请求体：`{ uri: string }`。
- `/banyan/style`：弹出样式选择对话框。请求体：`(StyleIdentifier & { documentId: string }) | { documentId: string }`。
- `/banyan/style/list`：返回已加载的样式列表，不打开 GUI。请求体：无；响应体：`StyleSummary[]`。
- `/banyan/citation`：弹出引注对话框。请求体：`CitationRequestData`。
- `/banyan/bibliography`：弹出参考文献行编辑对话框。请求体：`BibliographyRequestData`。
- `/banyan/refresh`：基于样式重新生成 citations 与 bibliography。请求体：`{ documentId, style, contexts, syncItems }`。`syncItems` 未显式设为 `false` 时，Banyan 会尝试从 Zotero 同步并回填完整条目数据；设为 `false` 时直接使用 `contexts` 中已有的 item 数据。
- `/banyan/convert`：将 Word 域代码转换为 Banyan 引用格式。请求体：`{ documentId, citationType, fields }`。`citationType` 为 `"intext-citation"` 或 `"note-citation"`，`fields` 为 `{ fieldId, fieldCode }[]`。
- `/banyan/progress`：控制进度条窗口。请求体：`{ action: "open" | "close", reason?: string }`。

### 错误语义与处理建议

- `ok: false, code: "cancelled"`：用户主动取消，业务可选择静默处理。
- `ok: false, code: "invalid_params"`：请求参数非法，先修正参数再重试。
- `ok: false, code: "dialog_open_failed" | "internal_error"`：Banyan 内部异常，建议提示用户并允许重试。
- 网络层异常（连接失败、超时）不属于协议范畴，客户端应自行重试或提示。

### 传输与超时

- 默认无流式数据，建议客户端设置 30–60 秒请求超时，超时后提示用户重试。
- 服务端请求体上限为 **20 MB**（`Content-Length` 超过则返回 `413`）。客户端无需自行截断。

### 未来兼容性

- 新增路由或字段会遵循向后兼容策略：新增字段为可选，现有字段不会变更语义。
- 如需固定 CORS 来源或鉴权，可在未来版本扩展端点策略。
