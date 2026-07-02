## Banyan Word 加载项手动安装

本文用于两类场景：

- Banyan 首选项里的自动安装失败，需要手动排查。
- 开发或测试时，需要跳过自动脚本，直接准备 Word sideload 环境。

当前 Banyan 的 Word 加载项清单地址为：

`https://ftp.zotero-chinese.com/addins/banyan/word/manifest.xml`

该清单对应的加载项网页资源由远端 HTTPS 地址提供，手动安装时只需要准备 manifest 文件的本地 sideload 环境。

### Windows

微软当前对 Windows 桌面版 Word 的 add-in only manifest sideload，仍然采用“共享目录 + Trusted Add-in Catalogs”的方式。官方说明见：

- https://learn.microsoft.com/en-us/office/dev/add-ins/testing/create-a-network-shared-folder-catalog-for-task-pane-and-content-add-ins
- https://learn.microsoft.com/en-us/office/dev/add-ins/publish/host-an-office-add-in-on-microsoft-azure

#### 方法一：在 Word 图形界面手动配置

1. 创建一个本地目录，例如：

   `C:\Users\<你的用户名>\AppData\Local\Banyan\WordAddinCatalog`

2. 右键该目录，打开“属性” > “共享”，把它共享出来，记下 UNC 路径，例如：

   `\\<你的计算机名>\BanyanWordAddin`

3. 下载 Banyan 的 manifest.xml，并放入这个共享目录中。文件名可以自定，Banyan 自动安装默认使用：

   `banyan-manifest.xml`

4. 打开 Word，新建任意文档，进入：

   `文件 > 选项 > 信任中心 > 信任中心设置 > 受信任的加载项目录`

5. 在 `Catalog Url` 中填入刚才的 UNC 路径，例如：

   `\\<你的计算机名>\BanyanWordAddin`

6. 选择 `Add catalog`。

7. 对新条目勾选 `Show in Menu`，然后确认关闭对话框。

8. 完全退出并重新打开 Word。

9. 进入：

   `主页 > 加载项 > 高级`

10. 在 `SHARED FOLDER` 中找到 Banyan，并选择 `Add`。

#### 方法二：用注册表直接写入 Trusted Catalog

微软官方文档给出的注册表形状是：

- 子键名是一个带花括号的 GUID。
- 子键内部的 `Id` 也必须是同一个 GUID。
- `Url` 是共享目录的 UNC 路径。
- `Flags=1` 表示 `Show in Menu`。

对于 Banyan，当前 manifest `<Id>` 是：

`{215c818a-2712-432e-8d3f-098c48b7a755}`

实测中，Word 对这个形状比较严格。即使目录存在、URL 可访问，如果子键名和 `Id` 不一致，Word 也可能不显示该目录。

可以创建一个 `.reg` 文件，内容如下，再双击导入：

```reg
Windows Registry Editor Version 5.00

[HKEY_CURRENT_USER\Software\Microsoft\Office\16.0\WEF\TrustedCatalogs\{215c818a-2712-432e-8d3f-098c48b7a755}]
"Id"="{215c818a-2712-432e-8d3f-098c48b7a755}"
"Url"="\\\\<你的计算机名>\\BanyanWordAddin"
"Flags"=dword:00000001
```

导入前请先把 `Url` 改成你的真实共享路径，并确认该共享目录里已经放入 manifest 文件。导入后重启 Word，再按上面的 `主页 > 加载项 > 高级 > SHARED FOLDER` 路径添加 Banyan。

### macOS

微软对 macOS 的手动 sideload 官方方式是直接复制 manifest 到 `wef` 目录。官方说明见：

- https://learn.microsoft.com/en-us/office/dev/add-ins/testing/sideload-an-office-add-in-on-mac

步骤如下：

1. 在 Finder 中按 `Cmd + Shift + G`。

2. 进入 Word 的 `wef` 目录：

   `/Users/<你的用户名>/Library/Containers/com.microsoft.Word/Data/Documents/wef`

3. 如果 `wef` 不存在，就手动创建。

4. 下载 Banyan 的 `manifest.xml`，复制到该目录中。

5. 完全退出并重新打开 Word。

6. 打开任意文档，进入：

   `主页 > 加载项`

7. 选择 Banyan，确认它可以正常打开。

### 开发环境清理

如果你在 Windows 上反复测试，需要回到干净环境，可以使用仓库内的开发脚本：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\resetWordAddinCatalog.ps1
```

这个脚本会删除：

- `HKCU\Software\Microsoft\Office\16.0\WEF\TrustedCatalogs` 下的 Banyan 目录项
- 旧版遗留的 `BanyanWordAddin` 注册表项
- 本机 `BanyanWordAddin` 共享
- `%LOCALAPPDATA%\Banyan\WordAddinCatalog` 目录

如果共享删除失败，通常是因为当前 PowerShell 没有管理员权限。
