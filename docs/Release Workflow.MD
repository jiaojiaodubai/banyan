# Banyan 发布工作流

Banyan 与两个“前端”集成仓库**绑定发布**：打包进 XPI 的
`addon/content/integration/` 产物全部由源代码仓库实时构建，确保插件与
WPS/Word 客户端版本一一对应。

| 集成       | 源码子模块                         | 构建方式                                                              | 产物落点                                          |
| ---------- | ---------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------- |
| WPS        | `integrations/Banyan-for-WPS`      | `npm install` + `npm run build`（仓库不提交 lockfile，故非 `npm ci`） | `addon/content/integration/WPS/<Name>_<Version>/` |
| Word (VBA) | `integrations/Banyan-for-Word-VBA` | 仓库内已提交 `Banyan.dotm`，直接复制                                  | `addon/content/integration/Word/Banyan.dotm`      |

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

   依次执行：`pnpm install`（锁文件随依赖范围刷新）→ `submodules:update`
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
   → push（commit + tag）。

   > 预发布可 `pnpm release prerelease` 等；类型也可在命令行覆盖。

3. **CI 自动发布**
   `push tag v**` 触发 `.github/workflows/release.yml`：
   - 检出（`submodules: recursive`、`fetch-depth: 0`）
   - `pnpm install --frozen-lockfile`
   - `pnpm integrations:build`（从**锁定的子模块 commit** 装配产物，保证可复现）
   - `pnpm build`
   - `pnpm release`：CI 下不 bump，直接创建 GitHub Release
     （tag `v<版本>`，上传 `*.xpi`；notes 由约定式提交自动生成），并把
     `update.json`/`update-beta.json` 上传到 `release` tag。

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
| CI lint（非 type-aware）                      | 否                                                            |
| CI build                                      | 是（`pnpm build` 内含 `gen:wps-addin-manifest` + 产物进 XPI） |
| CI test（`zotero-plugin test` 会 bundle src） | 是                                                            |
| Release                                       | 是                                                            |

因此 `ci.yml` 的 build/test 与 `release.yml` 都会在构建前执行
`pnpm integrations:build`。
