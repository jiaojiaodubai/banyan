startup-begin = 插件加载中
startup-finish = 插件已就绪

prefs-title = 榕树

styles-import-picker-title = 导入样式
styles-import-picker-filter-style = 样式文件 (*.js)
styles-import-picker-filter-any = 所有文件
styles-import-overwrite-confirm = 文件“{ $filename }”已存在，是否覆盖？
styles-overwrite-title = 覆盖样式
styles-id-overwrite-confirm = 样式“{ $aTitle }”的ID与已存在的样式“{ $bTitle }”冲突，是否覆盖？
styles-filename-overwrite-confirm = 文件“{ $filename }”已存在，是否覆盖？
styles-delete-title = 删除样式
styles-delete-confirm = { $count ->
    [one] 将删除“{ $title }”样式，是否继续？
   *[other] 将删除包括“{ $title }”在内的{ $count }个样式，是否继续？
}
styles-notfound-alert = 未找到样式“{ $title }”。请确保样式已正确安装。

inaccessible-items-title = 检测到不可访问的条目
inaccessible-items-intro = 此文档中有一些条目不可访问：
inaccessible-items-count-cross-library = { $count } 个条目来自其他用户的个人文库
inaccessible-items-count-deleted = { $count } 个条目已被删除
inaccessible-items-count-unknown-group = { $count } 个条目来自无法访问的群组文库
inaccessible-items-reason-heading = 这通常发生在以下情况：
inaccessible-items-reason-shared = 文档使用个人文库条目创建后与他人共享
inaccessible-items-reason-deleted = 条目在引用后被删除
inaccessible-items-reason-group-access = 群组文库的访问权限被撤销
inaccessible-items-solution-heading = 建议的解决方案：
inaccessible-items-solution-group = 协作使用：创建一个共享的群组文库并使用其中的条目
inaccessible-items-solution-group-link = 参见：https://www.zotero.org/support/groups
inaccessible-items-solution-import = 个人使用：将这些条目导入到你的文库（点击“导入条目”）
inaccessible-items-solution-ignore = 忽略：继续操作但不同步这些条目（不推荐）
inaccessible-items-action-heading = 你想如何操作？
inaccessible-items-action-import = 导入条目：将不可访问的条目导入到你的文库
inaccessible-items-action-ignore = 忽略：继续操作但不同步这些条目（将使用缓存数据）
inaccessible-items-action-cancel = 取消：停止刷新操作
inaccessible-items-button-import = 导入条目
inaccessible-items-button-ignore = 忽略
inaccessible-items-button-cancel = 取消

inaccessible-items-desc-deleted = 该条目已从文库中删除
inaccessible-items-desc-cross-library = 该条目来自其他用户的个人文库
inaccessible-items-desc-unknown-group = 该条目来自你无权访问的群组文库
inaccessible-items-desc-invalid-uri = 条目 URI 格式无效

server-origin-auth-intro = { $clientName } 正在请求访问 Banyan 的本地端点。
server-origin-auth-origin = 来源：{ $origin }
server-origin-auth-prompt = 是否允许此来源发送 Banyan 集成请求？

server-cert-trust-intro = Word for Mac 需要可信的本地 HTTPS 端点才能与 Banyan 通信。
server-cert-trust-explanation = Banyan 会向你的登录 Keychain 添加一个私有的、安装专用的证书颁发机构。它仅用于 https://localhost，卸载 Word 加载项时可将其移除。
server-cert-trust-prompt = 是否继续？