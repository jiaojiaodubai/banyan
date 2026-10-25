# 夹具注入工具

`fixtures.ts` 通过 Zotero Local API 把 [`../fixtures.json`](../fixtures.json) 中的集合和条目
幂等写入当前文库。它只创建或更新对象，不删除任何已有集合、条目或关系。

## 前置条件

- Zotero beta，且已启用本地 API：
  **编辑 → 设置 → 高级 → 允许其他应用与本机 Zotero 通信**。
- 已通过 `pnpm start` 或正常安装启用 Banyan 开发版。
- 使用专用测试配置或测试文库；不要对生产库运行。
- 在仓库根目录执行命令。工具从自身位置解析仓库根目录，不依赖当前工作目录。
- `.env` 中优先使用 `ZOTERO_PLUGIN_PROFILE_PATH` 读取配置档的 HTTP 端口；也可以用
  `ZOTERO_LOCAL_API_URL` 显式指定，例如 `http://127.0.0.1:23124/`。未配置时依次尝试
  配置档端口、`23119` 和 `23124`。

## 命令

```powershell
# 注入或更新夹具
pnpm exec tsx test-gui/harness/fixtures.ts

# 只校验当前库与 fixtures.json、上次同步的 serverID 是否一致
pnpm exec tsx test-gui/harness/fixtures.ts --check
```

## 行为

1. 读取并校验 `fixtures.json`（版本、集合 key、`citationKey`、集合引用和关系目标）。
2. 创建或校验顶层集合 `BNYMANUL` 及其子集合。已存在但名称或父集合不一致时拒绝覆盖。
3. 按 `citationKey` upsert 条目，并把每个条目同时放进顶层集合，附加
   `banyan-manual-fixture` 标签。
4. 第二次写入设置 `relations`；关系目标按 `citationKey` 解析为 Zotero item URI。
5. 重新读取并逐项核对集合归属、字段和关系；最后写入状态文件。
6. 状态文件为 `.state/fixtures.local.json`，记录 `serverID`、`fixtureSha`、集合 key 和
   `citationKey` → item key。该目录被 `.gitignore` 忽略，不要提交。

顶层集合和条目的完整清单见 [主文档 §3.3](../README.md#33-夹具集合)。

## 授权与状态

首次写请求会在 Zotero 中弹出授权提示；选择允许并勾选“记住”时，key 会保存到
`.state/local-api.local.json`。遇到 `401` 时删除该文件后重试；遇到 `403` 时检查本地 API
是否启用，以及是否在授权提示中拒绝过访问。

`.state/` 还可能保存用例的条目/设置备份。它属于本地运行状态，不进入仓库。

## 故障排查

- **连接失败**：确认 Zotero 已启动、本地 API 已启用，并检查 `ZOTERO_LOCAL_API_URL` 或
  配置档中的 `extensions.zotero.httpServer.port`。
- **集合已存在但名称不同**：工具拒绝覆盖。确认没有在测试库中手工改过 `BNYMANUL` 及其
  子集合；必要时换一个测试库。
- **关系不一致**：先重新运行注入；若仍失败，检查条目的 `relations` 是否被其他用例改写。
  夹具只 upsert，不会删除旧关系。
- **`--check` 报夹具已变化**：`fixtures.json` 与状态文件记录的 SHA 不同，重新运行注入。
- **`--check` 报 serverID 已变化**：当前连接的 Zotero 配置或文库变了，重新运行注入。

## 相关文件

- [`fixtures.json`](../fixtures.json)：集合与条目定义；
- [`fixtures.schema.json`](../fixtures.schema.json)：JSON Schema；
- [`lib/`](lib/)：配置解析、Local API 客户端、幂等同步与状态读写。
