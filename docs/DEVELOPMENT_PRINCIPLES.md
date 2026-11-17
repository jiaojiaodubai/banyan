# 开发原则与工作流

> 面向维护者和 Agent 的项目级工作原则。Agent 的快速强制约束在
> [AGENTS.md](../AGENTS.md)；环境、架构和命令见 [CONTRIBUTING.md](CONTRIBUTING.md)。
> 本文件只写“如何做决策、修复、提交、验证和沉淀”，不重复环境配置。

## 1. 适用范围与优先级

- 本文件对所有已发布历史之后的工作生效；没有“这次先例外”的默认空间。
- 约束优先级：用户当次指令 > `AGENTS.md` 的硬约束 > 本文件 > 一般开发习惯。
- `CONTRIBUTING.md` 是给人类开发者的环境与架构说明；Agent 不需要为了工作流程而通读它。
- 具体命令以仓库脚本和 `CONTRIBUTING.md` 为准；本文只规定何时、为什么执行。

## 2. 先调查，再决策

非显然的架构、API、兼容性决策，不能凭第一反应实现：

- 先查宿主源码（`dev/Zotero-Source`）、Zotero 官方文档、现有测试与文档，再看成熟产品
  的同类做法；
- 至少比较两个方案，写下各自的代价、收益、失败模式和被放弃的原因；
- 借鉴成熟产品时只取契约与思路，不继承其历史包袱；能用模块作用域、纯数据、单向
  API 解决的，不引入全局管理器或补丁层；
- 不添加没有源码证据的兼容分支或推测性抽象；
- 调研结论必须落盘（本地案例放 `dev/issues/`，需要长期共享的放 `docs/`），不能只留在
  会话里。

### 决策记录

使用 [`docs/templates/INCIDENT-REVIEW.md`](templates/INCIDENT-REVIEW.md) 的“方案与决策”
部分，或独立的 ADR/MADR 记录。记录必须包含：问题、约束、备选方案、选择理由、负面后果、
验证方式。决策状态至少区分 `draft`、`accepted`、`implemented`、`superseded`。

## 3. 修复放在正确的位置

### 3.1 先归属，再动手

- 判断问题属于宿主（Zotero 窗口/bundle、数据目录）、核心（`@banyan/core`）还是工具层；
- 修复放在正确的层，并尽量放在该层最早的正确提交中；
- 同一类修复合并到同一提交，不把已知问题一路带到最终 tip；
- 能用结构性修复（所有权、生命周期、可序列化边界）解决的，不用 token、WeakMap
  或补丁层掩盖。

### 3.2 一次做对

- 已知缺陷先修，依赖它的特性从引入时就用修复后的 API；
- 禁止“按旧模式完成特性，再加一个 fix 提交改正”；
- 如果问题是在未发布历史中发现的，重写对应提交，而不是在 tip 追加补丁；
- 每个提交都要自洽：功能、测试、类型、文档和生成产物在同一提交内一致；
- 中间提交不能依赖“最终 tip 会通过”来兜底。

## 4. 提交是交付物

### 4.1 原子性与独立性

- 一个提交只做一件可描述的事；重构与行为变化尽量分开；
- 每个提交都必须在当时可构建、可测试、可回退；
- 0.4.0 之后的**每一个提交**都独立通过：
  - `npx tsc --noEmit`
  - `pnpm lint:check`
  - `pnpm test:node`
  - `pnpm build`
  - `pnpm test --no-watch`（真实 Zotero 运行时）
- 不允许只验证最终 tip；历史重写后要逐提交重跑上述门禁。

### 4.2 历史与发布边界

- 只重写未发布范围；已发布提交、发布 tag 和发布产物视为不可变；
- 重写历史前必须获得用户确认，并在确认请求中同时说明：
  - **做什么**（哪些提交、哪些文件、影响范围）；
  - **为什么**（根因、为什么必须重写而不是追加提交、风险与回滚方式）。
- 重写前留备份分支；重写后校验最终树与已知良好版本一致；
- 默认不 push；tag 不移动、不重建，除非用户明确要求发布操作；
- 工作区必须干净，构建产物和生成文件不能混入无关提交。

### 4.3 发布、推送与 CHANGELOG

- **推送和发布必须得到明确授权**：不自行 `git push`、移动或重建发布 tag、创建或覆盖 GitHub Release；先说明将推送的提交范围、tag 与产物，得到用户明确同意后再执行；
- **只在发布提交中修改 `CHANGELOG.md`**：功能、修复和重构提交不更新它；发布提交（`chore(publish): release vX.Y.Z`）集中整理本次全部用户可见变更；
- **发布前检查 CHANGELOG**，三项都通过才发布：
  - **完整性**：本版本所有用户可见变更都有条目；
  - **准确性**：描述与最终代码和行为一致，不保留未实现、已改动或过时的说法；
  - **有效性**：其中的 commit hash、compare 链接在发布后都能解析；历史重写频繁时尤其要逐项核对。

## 5. 测试与证据

### 5.1 按失败模式选层

| 失败模式                             | 最低证据                                |
| ------------------------------------ | --------------------------------------- |
| 纯逻辑、解析、选择、校验             | Node 测试（`tests-node/`）              |
| Gecko 沙箱、宿主 API、realm/生命周期 | Zotero 进程内测试（`test/`）            |
| 原生窗口、焦点、剪贴板、菜单、迁移   | 本地 GUI 验收（`dev/`）或明确的手动记录 |
| 架构边界、共享状态                   | 运行时断言 + 契约文档映射               |

- 修复 bug 时先补一个能复现的回归测试；不能自动化的宿主交互写入 GUI 验收步骤；
- 测试数量与风险相称：核心纯函数多测，纯装配代码可用运行时/验收覆盖；
- 每项验证记录命令、结果和剩余盲区；不要用“应该没问题”代替证据；
- 公共契约与验证映射更新到 [HOST_OBLIGATIONS.md](HOST_OBLIGATIONS.md) 或对应测试规范。

### 5.2 历史重写的验证

- 逐提交跑全部门禁，记录每个提交的结果；
- 最终树与重写前已验证的备份树 diff 必须为空；
- 检查 tag、备份分支、工作区和生成文件状态；
- 发现中间提交失败时，修提交本身，不用“跳过验证”或最终追加补丁掩盖。

## 6. 文档与经验固化

- 反复出现、难以定位或涉及架构取舍的问题，必须写复盘/决策记录，不能只留在会话；
- 记录至少包含：根因链、触发因素、考虑过的方案、最终决策、剩余风险、验证证据、
  行动项和相关提交；
- 使用 [`docs/templates/INCIDENT-REVIEW.md`](templates/INCIDENT-REVIEW.md)；模板是下限，
  不是上限；案例可放 `dev/issues/`（本地）或 `docs/`（需要共享时）；
- 宿主契约变化同步到 `docs/HOST_OBLIGATIONS.md`，流程/命令变化同步到
  `CONTRIBUTING.md`，提交规范同步到本文；
- 定期合并重复、过期的文档，保持单一事实源；删除文档前先检查引用并改链；
- Agent 入口文件（`AGENTS.md`、`CLAUDE.md`）按“索引”维护，不写规则散文；具体见下节。

### Agent 入口文件是索引

`AGENTS.md` 会在每个会话/任务开始时被加载；它的每个 token 都会被反复计费，也会持续占用
模型的注意力预算。因此它应当是一张**任务路由表**，不是规则大全：

- 只保留：项目是什么（2–3 句）、每次都必须遵守的硬约束（构建/测试、历史边界、提交信息）、
  任务到文档的路由，以及完成检查的入口；
- 规则落在版本化文档中：工作流放 `docs/DEVELOPMENT_PRINCIPLES.md`，代码规范放
  `docs/CODING_CONVENTIONS.md`，宿主契约放 `docs/HOST_OBLIGATIONS.md`，复盘模板放
  `docs/templates/`；
- 判断标准：一条规则如果只对特定任务适用，就不要写进 `AGENTS.md`；在路由表里加一行
  “这类任务看哪里”。只有“每次都必须做/绝不能做”的规则才常驻；
- 定期审计：删除可推断、过期、重复的规则；目标是一屏内读完（约 80 行以内）。超过时先问
  哪些条目可以移到文档；维护流程、规则登记表和机械检查见
  [`docs/AGENTS_MAINTENANCE.md`](AGENTS_MAINTENANCE.md)；
- 指针必须可验证：链接应指向真实文件/章节；文档改名或删除时同步改链，避免 Agent 找不到。

依据与边界：

- OpenAI Codex 文档建议 `AGENTS.md` 保持小，只放构建/测试、评审期望和仓库约定等每次需要的
  规则，细节按需检索：<https://learn.chatgpt.com/docs/customization/overview.md>；
- Anthropic 的上下文工程指南把上下文视为有限“注意力预算”，主张最小高信号 token 与
  just-in-time 检索：<https://www.anthropic.com/research/effective-context-engineering-for-ai-agents>；
- IFScale 在 500 条指令密度下最佳模型仅 68% 遵循率，并存在“前面指令更受重视”的偏置：
  <https://arxiv.org/abs/2507.11538>；
- 社区实践：[AGENTS.md as a Table of Contents](https://raw.githubusercontent.com/agentpatterns-ai/website/refs/heads/main/instructions/agents-md-as-table-of-contents.md)
  与
  [ODR-0010: CLAUDE.md Progressive Disclosure](https://github.com/workleap/wl-squide/blob/39abbaf9248f111b5f2187a48fd531ae472f88b9/agent-docs/odr/0010-claude-md-progressive-disclosure-design.md)
  都把自动加载文件设计成索引而非知识库；
- 边界：索引假设 Agent 会按需打开链接。ETH Zurich 的 AGENTS.md 研究指出上下文文件会增加
  推理成本，且“仓库概览”未必提升任务成功率；因此索引必须保留少量真正关键的硬约束，
  并用具体路由代替泛泛的“读所有文档”：
  <https://arxiv.org/abs/2602.11988>。

## 7. 提交信息

采用“短 subject + 空行 + 分点 body”：

- subject 使用祈使句、首字母大写、不加句号；建议不超过 50 字符，硬上限 72；
- subject 与 body 之间空一行；body 说明 what/why，不写长段落；
- body 用 `-` 分点，每行控制在 72 字符左右；必要时给出验证命令或关联文档；
- 一个提交只表达一个意图；不把格式化、重构和行为变化混在一起。

示例：

```text
fix(styles): keep executable style state in the owning window

- Cache style instances in each window bundle and keep the shared file index
  serializable: files plus a monotonic epoch.
- Move executable declarations into a main-window-only module; dialogs request
  index reloads and field checks through `addon.api`.
```

参考：

- Chris Beams, _How to Write a Git Commit Message_：
  <https://cbea.ms/git-commit/>
- Conventional Commits：<https://www.conventionalcommits.org/en/v1.0.0/>

## 8. 大改动与协作

- 大范围历史重写、跨层重构、公共接口变化或不可逆操作，先给方案、备选和取舍，
  获得用户明确确认后再执行；
- 确认请求必须同时包含“做什么”和“为什么”；只说“我要重写历史”会造成困惑；
- 执行中如出现失败、回滚或与预期不符的结果，如实报告，不把失败藏在最终总结里；
- 文档和规范类修改，先给提纲或草案供审阅，再写入仓库。

## 9. 反模式

- 一拍脑袋就改，事后补理由；
- 明知是宿主层问题，却拖到核心迁移之后；
- 先按旧 API 写特性，再补一个 fix 提交；
- 只验证最终 tip，中间提交不可构建；
- 修改已发布历史或移动发布 tag；
- 提交信息写大段散文，不查规范；
- 把经验只留在会话里，不落盘；
- 同一事实在多份文档重复维护，或保留已过期的调研文档；
- 用全局 token、WeakMap 或兼容分支给结构性问题打补丁。

## 10. Definition of Done

一个任务至少满足：

- [ ] 问题根因和归属层已确认；修复位于最早的正确提交，同类问题未被带到后续；
- [ ] 新特性从引入起使用当前架构，没有“先旧后新”的过渡态；
- [ ] 相关测试已补，失败模式对应的测试层已覆盖；宿主交互有 GUI 验收或明确说明；
- [ ] 每个提交独立通过 `tsc` / lint / Node / build / 真实 Zotero 运行时门禁；
- [ ] 最终树与已知良好备份一致；工作区干净；tag 和已发布历史未动；
- [ ] 提交信息符合 subject + 分点 body 规范；
- [ ] 顽固问题已用模板记录，契约文档和过时文档已同步；
- [ ] 大改动已获用户确认，执行中的失败和剩余风险已如实记录。

## 11. 参考来源

- Google SRE Book：_Postmortem Culture_ 与 _Example Postmortem_：
  <https://sre.google/sre-book/postmortem-culture/>、
  <https://sre.google/sre-book/example-postmortem/>
- incident.io：SRE incident post-mortem template：
  <https://incident.io/blog/sre-incident-postmortem-best-practices>
- PagerDuty Incident Response：Postmortem Template：
  <https://docs.pagerduty.com/ops-guides/incident-response-guide/postmortem-template>
- GitLab RCA/incident review template：
  <https://github.com/gitlabhq/gitlabhq/blob/master/.gitlab/issue_templates/rca.md>
- MADR（Markdown Architectural Decision Records）：
  <https://adr.github.io/madr/>
- Rust RFC template（备选方案、缺点、未解决问题）：
  <https://github.com/rust-lang/rfcs/blob/master/0000-template.md>
