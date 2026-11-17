# AGENTS.md 维护规范

> `AGENTS.md` 会在每个任务开始时自动加载；它的每个 token 都会重复占用上下文和注意力。
> 本文件规定如何增删、审计和机械校验 `AGENTS.md`，避免它重新长成规则大全。
> 检查命令：`pnpm check:agents`（已纳入 `pnpm lint:check` 与 CI）。

## 1. 定位与硬约束

`AGENTS.md` 是**任务索引**，不是知识库：

- 只允许四类内容：项目是什么（2–3 句）、每次都必须遵守的硬约束、任务到文档的路由、
  完成检查的入口；
- 目标一屏内读完，**软上限 80 行**；当前约 43 行；
- 必需的二级标题：`## Non-negotiables`、`## Task routing`；
- 所有本地链接必须指向真实文件；`pnpm check:agents` 会校验；
- 细节不写进 `AGENTS.md`：代码规范进 `docs/CODING_CONVENTIONS.md`，工作流进
  `docs/DEVELOPMENT_PRINCIPLES.md`，宿主契约进 `docs/HOST_OBLIGATIONS.md`，复盘进
  `docs/templates/INCIDENT-REVIEW.md`；
- `CLAUDE.md` 只做兼容入口，指向 `AGENTS.md`，不复制规则。

## 2. 什么内容放哪里

| 内容                     | 放 `AGENTS.md`？        | 正确位置                                                                    |
| ------------------------ | ----------------------- | --------------------------------------------------------------------------- |
| 项目一句话/边界          | 是，2–3 句              | —                                                                           |
| 每次都必须遵守的硬约束   | 是，最多约 6 条         | —                                                                           |
| 任务路由                 | 是，一行任务 → 一份文档 | —                                                                           |
| 完成检查入口             | 是，一行链接            | —                                                                           |
| 代码风格/日志/类型/lint  | 否                      | `docs/CODING_CONVENTIONS.md`                                                |
| 工作流、提交、历史、验证 | 否                      | `docs/DEVELOPMENT_PRINCIPLES.md`                                            |
| 架构、背景、历史         | 否                      | `docs/` 或 `dev/` 案例                                                      |
| 测试步骤、GUI 验收       | 否                      | `docs/CONTRIBUTING.md#测试`                                                 |
| 单次事故的特殊规则       | 否                      | `docs/templates/INCIDENT-REVIEW.md`；若反复出现，再把通用部分升级为文档规则 |
| 提交信息细节             | 否                      | `docs/DEVELOPMENT_PRINCIPLES.md#7-提交信息`；`AGENTS.md` 只保留一行格式约束 |

判断顺序：

1. **这条规则每次任务都适用吗？** 否 → 放对应文档，在路由表加一行。
2. **删掉后 Agent 会失去关键入口吗？** 是 → 保留为指针或硬约束；否 → 删除。
3. **仓库现状已经能推断出来吗？** 是 → 不写。
4. **有证据说明它防止了真实失败吗？** 否 → 先不要写；等有事故/评审记录再固化。

## 3. 变更流程

新增或修改 `AGENTS.md` 时：

1. 先判断内容属于“硬约束”“路由”“项目概述”还是“细节”；细节先写入目标文档。
2. 如果新增硬约束：解释它防止的真实失败；在本文 §4 的规则登记表补一行（来源、
   适用范围、复查条件）；同时删除一条可推断或过期的规则，尽量保持总行数不增长。
3. 如果新增路由：确认目标文件存在且标题锚点有效；不要让 Agent “先读全部文档”。
4. 运行 `pnpm check:agents`，再运行 `pnpm lint:check`。
5. 提交信息使用 `docs(agents): ...`，说明“为什么改”和“删了什么”，而不是只写“更新
   AGENTS.md”。

不允许：

- 因为一次对话不顺就把整段工作流粘进 `AGENTS.md`；
- 在 `AGENTS.md` 重复已经写在 `docs/` 的规则；
- 绕过 `check:agents` 或为了通过检查删除必需章节；
- 把 `CLAUDE.md` 重新填成第二份规则大全。

## 4. 审计与规则生命周期

触发审计的时机：

- 每次修改 `AGENTS.md`；
- 每次发布前；
- Agent 连续两次犯同一类错误，或反复忽略某条路由；
- 路由目标文档被移动、重命名或删除。

审计清单：

- [ ] `pnpm check:agents` 通过（行数、标题、本地链接）；
- [ ] 每条 non-negotiable 仍是“每次都必须遵守”，且对应真实失败；
- [ ] 路由表中的文档都存在，且没有“读全部文档”式泛化指令；
- [ ] 没有可推断、过期、重复的规则；删掉后行为不会退化的规则应删除；
- [ ] 细节都在对应文档中，`AGENTS.md` 只留入口；
- [ ] `CLAUDE.md` 仍只是指针；
- [ ] 本次变更的提交信息说明了增删理由。

当前规则登记表（维护在本文，不写进 `AGENTS.md`）：

| 规则                                | 来源/为什么需要                                                        | 适用范围   | 复查/失效条件                |
| ----------------------------------- | ---------------------------------------------------------------------- | ---------- | ---------------------------- |
| 每个提交独立通过五道门禁            | 历史重写后中间提交不可构建会破坏 bisect 和回滚；本仓库已要求逐提交验证 | 所有提交   | 门禁命令或发布流程改变时同步 |
| 不重写已发布历史、不动 tag          | 已发布产物不可逆；tag 是发布事实                                       | 历史操作   | 发布策略改变时               |
| 重写未发布历史前询问“做什么+为什么” | 避免不可逆操作造成困惑和损失                                           | 历史重写   | 保留                         |
| 提交信息短 subject + 分点 body      | 提交是长期文档；长段落难读                                             | 所有提交   | 提交规范改变时               |
| 先调研再决定                        | 避免拍脑门的架构/兼容性决策                                            | 非显然决策 | 保留                         |
| 提交原子、工作区干净                | 可审查、可回滚、可复现                                                 | 所有提交   | 保留                         |

> 为什么不在 `AGENTS.md` 里逐条标注 source/applicability/expiry：那是第二个清单，
> 会重新把文件撑大；登记表放本文，`AGENTS.md` 只保留规则本身。

## 5. 证据

这些结论来自官方工程指南、基准研究和社区维护模式：

- **OpenAI Codex 官方文档**：`AGENTS.md` 应保持小，只放每次都要遵循的构建/测试命令、
  评审期望和仓库约定；细节按任务检索，不要要求 Agent 每次编辑前读完整套文档。
  <https://learn.chatgpt.com/docs/customization/overview.md>
- **OpenAI Harness 团队的经验**：“one big AGENTS.md”会造成上下文拥挤、注意力稀释、
  范围不可验证、快速过期；建议用约 100 行的指针地图，配合 `docs/`、链接校验和
  文档巡检。AgentPatterns 对此有整理与延伸：
  <https://raw.githubusercontent.com/agentpatterns-ai/website/refs/heads/main/instructions/agents-md-as-table-of-contents.md>
- **Anthropic 上下文工程指南**：上下文是有限“注意力预算”，目标是“最小可能的高信号
  token 集合”；主张 just-in-time 检索和渐进式披露：
  <https://www.anthropic.com/research/effective-context-engineering-for-ai-agents>
- **Anthropic Agent Skills**：用“元数据 → 指令正文 → 按需资源”的三级渐进披露，
  让核心文件保持精简：<https://www.anthropic.com/research/equipping-agents-for-the-real-world-with-agent-skills>
- **IFScale（NeurIPS 2025）**：500 条同时指令下最佳模型仅 68% 遵循率，且前面的指令
  更容易被遵循；说明指令密度本身会降低单条规则的可靠性：
  <https://arxiv.org/abs/2507.11538>
- **社区实践 ODR-0010**：自动加载文件每个 token 每次会话都付费；最终采用约 50 行的
  单一索引，而不是路由表 + 目录两套结构：
  <https://github.com/workleap/wl-squide/blob/39abbaf9248f111b5f2187a48fd531ae472f88b9/agent-docs/odr/0010-claude-md-progressive-disclosure-design.md>
- **Claude Code 最佳实践**：把 `CLAUDE.md` 当作代码维护——出问题时审查、定期修剪，
  并通过观察行为是否改变来验证修改；能被推断/已经做对的规则应删除或转成机制：
  <https://code.claude.com/docs/en/best-practices>
- **ETH Zurich 的 AGENTS.md 研究（边界条件）**：上下文文件平均增加 20% 以上推理成本；
  仓库概览未必提升成功率，LLM 生成的文件甚至可能略有负面效果；指令会被遵循，但
  “指针地图”依赖 Agent 真的按链接打开文档。所以索引必须保留少量关键硬约束，并用
  具体路由代替泛化描述：<https://arxiv.org/abs/2602.11988>

结论：**索引模式成立，但它是“最小高信号 + 可验证路由”，不是“把所有规则删光”。**
本文件的机械检查和规则登记表就是这两个前提的闭环。

## 6. 机械检查

`pnpm check:agents`（`scripts/checkAgentsDoc.mjs`）检查：

- `AGENTS.md` 不超过 80 行；
- 存在 `## Non-negotiables` 与 `## Task routing` 标题；
- 所有本地 Markdown 链接（去掉锚点、解码 URL）都能解析到真实文件。

它已包含在 `pnpm lint:check` 中，因此提交钩子和 CI 都会执行；失败时修改
`AGENTS.md` 或目标文档，而不是跳过检查。

## 7. 维护记录

`AGENTS.md` 的逐次变化以提交历史为准；本文件 §4 的登记表记录规则级来源和复查条件。
若某条规则被删除，在提交信息中写清楚“删了什么、为什么可以删”，不要静默消失。
