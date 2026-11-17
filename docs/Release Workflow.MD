# Banyan 发布工作流

Banyan 与两个“前端”集成仓库**绑定发布**：打包进 XPI 的
`addon/content/integration/` 产物全部由源代码仓库实时构建，确保插件与
WPS/Word 客户端版本一一对应。

| 集成       | 源码子模块                         | 构建方式                                         | 产物落点                                          |
| ---------- | ---------------------------------- | ------------------------------------------------ | ------------------------------------------------- |
| WPS        | `integrations/Banyan-for-WPS`      | `npm ci` + `npm run build`（锁文件随子模块提交） | `addon/content/integration/WPS/<Name>_<Version>/` |
| Word (VBA) | `integrations/Banyan-for-Word-VBA` | 仓库内已提交 `Banyan.dotm`，直接复制             | `addon/content/integration/Word/Banyan.dotm`      |

> `addon/content/integration/` 本身被 `.gitignore` 忽略，永不提交；CI 每次
> 从子模块装配后再构建。

## 常用命令

```powershell
# 初始化/更新子模块
pnpm submodules:init                 # 首次克隆（等价 git submodule update --init --recursive）
pnpm submodules:update               # 推进到各仓库远端默认分支（会改动父仓库指针，需审查后提交）

# 从子模块装配集成产物（WPS 构建 + Word dotm 复制 + 重新生成 WPS manifest）
pnpm integrations:build

# 维护 CHANGELOG.md（基于上次 v* tag 的约定式提交，写入 Unreleased 段）
pnpm changelog
```

## 发布流程（本地推进 → CI 发布）

Scaffold 采用“本地打 tag → CI 出资产”两段式，避免 GitHub Release 不可复现：

1. **整理与更新**

   ```powershell
   pnpm release:prepare
   ```

   依次执行：`pnpm update`（锁文件随依赖范围升级）→ `submodules:update`
   → `integrations:build` → `pnpm build` → `pnpm changelog`。
   此时 `git status` 会出现：子模块指针更新、`CHANGELOG.md`、可能还有依赖
   锁文件变化。**请人工 review 并补充**（可手改 `CHANGELOG.md` 或补提交），
   再 `git add` 需要的改动。

   > `integrations/` 目录被 `.gitignore` 忽略，子模块指针更新需显式强加：
   > `git add -f .gitmodules integrations`；也可以不做 `git add`，直接让第 2
   > 步 `bumpp.all: true` 的 `git commit --all` 提交已跟踪的 gitlink。

2. **版本号与标签**

   ```powershell
   pnpm release            # = zotero-plugin release
   ```

   本地（非 CI）阶段：`bumpp` 交互式选择版本 → 提升 `package.json` →
   `execute: pnpm build`（用新版本号构建）→ 用
   `chore(publish): release v%s` 提交**全部已跟踪改动**
   （`release.bumpp.all: true`，包含子模块指针/CHANGELOG）→ 打 `v<版本>` tag
   → push（commit + tag）。`pre-commit` 会运行 `pnpm test:dev`；推送 `v*` 标签时，
   `pre-push` 会运行 `pnpm test:release`。本地钩子验证当前工作树，发布前应检查
   工作树与标签一致；CI 以标签提交为准重新构建和验证。

   > 预发布可 `pnpm release prerelease` 等；类型也可在命令行覆盖。

3. **CI 自动发布**
   `push tag v**` 触发 `.github/workflows/release.yml`：
   - 检出（`submodules: recursive`、`fetch-depth: 0`）
   - `pnpm install --frozen-lockfile`
   - `pnpm integrations:build`（从**锁定的子模块 commit** 装配产物，保证可复现）
   - 下载官方 Linux Zotero **beta**，在 Xvfb 中运行 `pnpm test:dev`
   - `pnpm build`
   - 在 Xvfb 中运行 `pnpm test:prod`
   - `pnpm verify:prod` 校验标签、测试记录、XPI SHA-256、更新清单和 SHA-512
   - 删除旧 release 前和 scaffold 上传前再次验证；CI 中不会重新构建已测试的 XPI
   - `pnpm release`：CI 下不 bump，直接创建 GitHub Release
     （tag `v<版本>`，上传 `*.xpi`；notes 由约定式提交自动生成），并把
     `update.json`/`update-beta.json` 上传到 `release` tag。

## 生产测试

`pnpm test:release` 依次运行 `pnpm build`、`pnpm test:prod` 和 `pnpm verify:prod`。
单独运行 `pnpm test:prod` 时，需先构建 XPI 并设置
`ZOTERO_PLUGIN_ZOTERO_BIN_PATH`（可在 `.env` 中配置）。测试先检查 XPI 清单、编辑器
资源、Fluent 文件和集成清单所列资源，再把同一 XPI 安装到独立 profile 中，启动并重启
Zotero，检查生产模式、启动失败、样式索引、引用生成和菜单本地化。静态清单覆盖关键
资源，但不声称覆盖所有动态加载路径。

测试成功后，`.scaffold/prod-tested.json` 记录 XPI 路径和 SHA-256；任何失败都会清除
旧记录。运行时日志保存在 `.scaffold/prod-smoke.log`，CI 失败时上传该日志。观察器仅
存在于临时 profile，正常退出、超时或中断后会清理 profile、数据、观察器与进程。
不要在其他 Zotero 实例或更新运行时执行测试。

> GitHub Release notes 可在发布后于网页手工编辑补充；若希望 notes 与提交的
> `CHANGELOG.md` 完全一致，可将 `zotero-plugin.config.ts` 的
> `release.changelog` 改为读取文件首段的函数（当前使用 Scaffold 默认约定式
> 生成，与 `pnpm changelog` 同引擎，保持一致）。

## 版本化与更新渠道

- `package.json` 版本含 `-` 前缀 → 预发布（`update-beta.json`），否则正式
  （`update.json`）。`zotero-plugin.config.ts` 的 `makeUpdateJson.hash` 会附
  带 `update_hash`（XPI sha512），Zotero 据此校验下载。

## CI 中的“谁在构建什么”

| Job                                           | 是否需要集成产物                                              |
| --------------------------------------------- | ------------------------------------------------------------- |
| CI lint（非 type-aware）                      | 是（`src/modules/integration.ts` 导入生成的 WPS 清单）        |
| CI build                                      | 是（`pnpm build` 内含 `gen:wps-addin-manifest` + 产物进 XPI） |
| CI test（`zotero-plugin test` 会 bundle src） | 是                                                            |
| Release                                       | 是                                                            |

因此 `ci.yml` 的 build/test 与 `release.yml` 都会在构建前执行
`pnpm integrations:build`。
