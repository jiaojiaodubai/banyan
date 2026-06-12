## Banyan 本地集成接口指南

面向：本地集成插件开发者（例如文字处理器、AI 辅助工具）。Banyan 通过本地 HTTP 服务与外部进程交互，不需要公网网络。

### 通用说明

- 路由前缀：所有 Banyan 接口均注册在 `/banyan/*`。
- 方法与编码：各路由均为 `POST`，请求体 `application/json`；响应为 JSON。
- 响应格式：`{ ok: true, data }` 或 `{ ok: false, error: { code, message } }`。取消对话框等预期行为也返回 200，但 `ok: false`、`code: "cancelled"`。
- 状态码：通常为 `200`（成功或业务级取消）、`400`（参数/内容类型错误）、`500`（内部异常）。
- 端口说明：端口由 Zotero HTTP Server 统一管理，不再由 Banyan 插件首选项单独配置。
- 数据契约：详见 `typings/server.d.ts` 与 `typings/style.d.ts`。

### 快速示例

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

  const res = await fetch(`${base}/banyan/citation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
- `/banyan/showInLibrary`：在 Zotero 主界面定位条目。请求体：`{ id: number }`。
- `/banyan/style`：弹出样式选择对话框。请求体：`StyleIdentifier | undefined`。
- `/banyan/citation`：弹出引注对话框。请求体：`CitationRequestData`。
- `/banyan/bibliography`：弹出参考文献行编辑对话框。请求体：`BibliographyRequestData`。
- `/banyan/refresh`：基于样式重新生成 citations 与 bibliography。请求体：`{ style, contexts }`。
- `/banyan/progress`：控制进度条窗口。请求体：`{ action: "open" | "close", reason?: string }`。

### 错误语义与处理建议

- `ok: false, code: "cancelled"`：用户主动取消，业务可选择静默处理。
- `ok: false, code: "invalid_params"`：请求参数非法，先修正参数再重试。
- `ok: false, code: "dialog_open_failed" | "internal_error"`：Banyan 内部异常，建议提示用户并允许重试。
- 网络层异常（连接失败、超时）不属于协议范畴，客户端应自行重试或提示。

### 传输与超时

- 默认无流式数据，建议客户端设置 30–60 秒请求超时，超时后提示用户重试。
- 请求体一般在 KB 级别，仍建议设定一个上限（如 256KB），避免意外发送过大数据。

### 未来兼容性

- 新增路由或字段会遵循向后兼容策略：新增字段为可选，现有字段不会变更语义。
- 如需固定 CORS 来源或鉴权，可在未来版本扩展端点策略。
