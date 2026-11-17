# 编码约定

> 本文件是代码修改的单一来源：文件与日志、类型与宿主 API、lint/typecheck、生成文件。
> 环境配置、仓库结构与代码归属见 [CONTRIBUTING.md](CONTRIBUTING.md)；工作流与提交
> 规则见 [DEVELOPMENT_PRINCIPLES.md](DEVELOPMENT_PRINCIPLES.md)。

## 文件与日志

- 文件 I/O 使用 `IOUtils`，路径处理使用 `PathUtils`。
- 日志通过 `src/utils/logger` 的 `createLogger()` 输出；禁止直接调用 `console.log`、
  `console.error` 或 `ztoolkit.log`。记录错误时将 `Error` 作为第二个参数传入。
- 兼容处理只放在 `src/utils/compat/`，且必须已有源码证据证明是最新稳定版与 beta 之间的
  API 差异；不要添加面向更旧版本的兼容分支或推测性代码。

## 类型与宿主 API

- 使用 Zotero/Gecko API 前，先查 `zotero-types`；类型或行为不完整时，核对
  `dev/Zotero-Source`，并在 `typings/` 中补声明，不用局部 `as` 断言掩盖类型缺口。
- 比较 Zotero API 时，用 Git 对象检查稳定版 tag 与 `origin/main`；忽略
  `dev/Zotero-Source` 工作树中的改动。
- 跨模块共享类型放在 `typings/`；模块私有类型留在所属模块，放在 import 之后、文件级
  常量之前。
- 样式作者契约由 `@banyan/core` 维护：`typings/{item,style,styleUtils,unit}.d.ts` 只
  re-export 核心类型；编辑器与 AI 工作区副本由 `pnpm gen:style-editor-dts` 生成。
  插件自有的样式索引形状放 `typings/styleIndex.d.ts`。

## Lint、类型检查与构建

仓库有三个 lint/类型检查区域：

| 区域       | 配置或项目                                       | 命令                                                    |
| ---------- | ------------------------------------------------ | ------------------------------------------------------- |
| 插件主代码 | `eslint.config.mjs`                              | `pnpm lint:main` / `pnpm lint:fix:main`                 |
| 样式编辑器 | `addon/content/styleEditor/eslint.config.mjs`    | `pnpm lint:style-editor` / `pnpm lint:fix:style-editor` |
| 测试项目   | `test/tsconfig.json`、`tests-node/tsconfig.json` | `pnpm typecheck:tests`                                  |

完成代码修改后先运行 `pnpm lint:fix`，再运行 `pnpm lint:check`；构建与类型检查使用
`pnpm build`。提交前还要按 [DEVELOPMENT_PRINCIPLES.md](DEVELOPMENT_PRINCIPLES.md) 执行
完整门禁。

## 生成文件与工具链

样式作者的 lint 规则与 `@banyan/core` 都由同一个已发布的工具链修订提供，修订号和产物哈希
记录在 `toolchain.lock.json`；依赖安装的是该修订的发布 tarball。

- `addon/content/styleEditor/eslint-plugin-banyan-style.mjs` 与
  `eslint-plugin-banyan-style.build.json` 是从工具链生成的副本；不要手改。
- `pnpm lint:check` 运行 `pnpm check:style-lint` 检查副本是否漂移。
- 要改规则或核心，去 `Banyan-Toolchain` 修改并发布新修订，更新依赖与 lock 后运行
  `pnpm gen:style-lint`。
