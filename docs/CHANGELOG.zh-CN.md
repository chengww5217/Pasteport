# 更新日志

<p align="center">
  <a href="../CHANGELOG.md">English</a> ·
  <strong>简体中文</strong> ·
  <a href="CHANGELOG.zh-TW.md">繁體中文</a> ·
  <a href="CHANGELOG.ja.md">日本語</a>
</p>

本项目所有值得记录的变更都写在这里。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循
[语义化版本](https://semver.org/lang/zh-CN/spec/v2.0.0.html)。

## [0.0.2] - 2026-08-27

### 新增

- 界面已本地化为简体中文、繁体中文、日语、韩语、法语、德语、西班牙语、俄语和巴西葡萄牙语，并跟随
  VS Code 自身的显示语言。命令标题和设置说明来自 `package.nls.*.json`，对话框和通知来自
  `l10n/bundle.l10n.*.json`。日志输出特意保持英文，因为错误报告需要附上它。
- 翻译后的文档：`docs/README.zh-CN.md`、`docs/README.zh-TW.md` 和 `docs/README.ja.md`，以及
  `docs/CHANGELOG.<locale>.md` 下对应语言的更新日志，并在每份 README 和更新日志的顶部互相链接。
  它们不会打进 vsix，商店展示的是英文版。
- `Pasteport: Show Resolved Remote Directory`（显示解析后的远程目录），可以直接看到一次粘贴实际会用的
  目录；`pasteport.remoteDir` 设置的说明里带有一个指向它的链接，就放在输入框旁边。

### 变更

- Linux 上，暂存的剪贴板图片改放在按用户隔离的目录里：系统临时目录下的 `pasteport-staging-<uid>`，
  并以 `0700` 权限创建。原来的固定名字落在人人共享、全局可写的 `/tmp` 里：同一台机器上的其他用户
  要么能读到路过的每一张截图，要么能猜出那个只有毫秒级时间戳的文件名，提前建好目录埋下一个符号
  链接。macOS 和 Windows 本来就给每个用户私有的临时目录，那边没有变化。`Pasteport: Diagnose`
  会打印正在使用的路径。
- `pasteport.remoteDir` 的默认值改为空，意思是自动检测。远程主机自己的 `TMPDIR` 通过
  `workspace.fs` 从远程服务器进程的环境（`/proc/self/environ`）中读出，读不到则退回 `/tmp` 和
  `/var/tmp` 中先存在的那个，再退回 `/tmp` 并记录一条警告。文件落在所选目录的 `pasteport` 子目录
  下。主机把 `TMPDIR` 指向别处时，现在会按主机的设置来，而不是被忽略；显式设置该值则完全跳过检测。
  检测只是几次读取，每个远程主机每个会话只有一次。
- `pasteport.remoteDir` 现在是用户级设置，和其他设置一样可以被你打开的工作区覆盖，因此仓库可以决定
  你的粘贴落到哪里。设置描述和 README 都提醒：只在信任的工作区里粘贴。
- `Pasteport: Diagnose` 会同时报告配置的远程目录和解析后的远程目录。

### 修复

- 传输进行中按粘贴键不再毫无反应：扩展自己的处理会被放弃，但按键仍像以往一样传给终端。
- 之前，剪贴板读取器一旦抛异常，粘贴键就会被吞掉；现在这种异常（正常情况下读取器都会返回错误负载，
  而不是抛异常）会让按键照常传给终端。
- 远程目录检测有了超时上限，而且只有主机真的回答了才会记住结果。在远程文件系统尚未就绪时跑过的
  检测，不会再让 `/tmp` 被固定为整个会话的结果；半死的连接也不会再让粘贴命令永远等下去。
- 远程文件名中的反引号和 `$` 会被去掉，所以名为 ``x`id`.png`` 的文件不会再把命令替换带进提示符。
  其他 shell 元字符保持原样 —— `(` 和 `)` 在截图名里很常见 —— 因此原样粘贴的名字在由 shell 解析
  时仍可能需要 `quoting: shell`。
- Windows 读取器在暂存图片前会先验证内容：剪贴板上有些数据虽然被标记为 `PNG`，字节却未必是真的
  PNG（不少应用会把其他数据标成 PNG 格式），一旦校验不过，就改用剪贴板里的位图重新生成一份真正的
  PNG —— Linux 读取器从最初就是这样做的；读过的剪贴板数据流也会被释放。
- Linux 安装助手改用找到的绝对路径来启动包管理器和 `pkexec`，因为该命令以 root 身份运行。
- 装着数千个文件的剪贴板不会再让读取器死于 `ENOBUFS`：输出上限从 1 MB 提到 8 MB。那条管道里传的
  只有路径，从来不是图片字节。
- `release.yml` 通过环境变量把标签版本号传给 shell，而不是插值进命令行。

## [0.0.1] - 2026-08-24

已发布于 [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=chengww.pasteport)
和 [Open VSX](https://open-vsx.org/extension/chengww/pasteport)。

### 新增

- 把 macOS 剪贴板里的图片和文件粘贴进 VS Code 远程窗口的终端；远程路径会插入到提示符处。
- 通过 `workspace.fs` 传输，URI 借自窗口本身，因此每种远程后端都走同一条代码路径。已在
  Remote - SSH 上端到端验证。
- 按指纹去重：8 MB 以内用内容 SHA-256，超过则用 `size:mtime:name`。远程已存在且大小正确的副本会被
  复用，而不是重传。
- 从第一毫秒起就显示状态栏进度；对预计超过 `pasteport.confirmAboveSeconds` 的传输，会先弹确认对话
  框，再显示可取消的通知 —— 预估基于你自己链路上实测的吞吐量。
- 对已上传文件和本地暂存图片做 TTL 清理，启动时在后台执行，也可通过
  `Pasteport: Clean Up Remote Files` 手动触发。
- `Pasteport: Diagnose`，报告一次成功粘贴所依赖的每一个条件。
- 设置项：`remoteDir`、`quoting`、`trailingSpace`、`confirmAboveSeconds`、`ttlHours`、
  `bracketedPaste`。
- Windows 客户端支持：一个 PowerShell 读取器，剪贴板有 PNG 格式时取它，否则取位图，绑定到
  <kbd>Ctrl</kbd>+<kbd>V</kbd>。
- Linux 客户端支持：Wayland 上用 `wl-paste`，X11 上用 `xclip`，处理 `text/uri-list` 和
  `x-special/gnome-copied-files`，绑定到 <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd>。
- Linux 剪贴板工具缺失时提供安装：命令会在执行前展示出来，提权走 `pkexec` 以便由桌面自己弹出认证
  提示，不受支持的发行版和源码发行版会被告知该运行什么，而不是替他们瞎猜。
- 把 `pasteport.paste` 贡献进 `terminal.integrated.commandsToSkipShell`，否则 Windows 上的粘贴键
  会被送进 shell，永远到不了扩展。
- 一个扩展图标，打包时由 `scripts/build.mjs` 从 `assets/icon.svg` 栅格化生成；仓库里不提交任何图像文件。
- 用 esbuild 打包：扩展以单个压缩后的 `dist/build/extension.js` 发布，vsix 里既没有测试也没有
  source map。

### 已知限制

- Windows 和 Linux 读取器还没有在真实桌面会话中被人用过；两者都有单元测试覆盖，Windows 那个还在 CI
  里对着真实的 PowerShell 跑。
- PowerShell 的启动开销在真实硬件上尚未实测。它落在每一次粘贴上，包括纯文本粘贴；探测超过 150ms 时
  扩展会记录一条警告。
- 后端只验证过 Remote - SSH；Dev Containers、WSL 和 Tunnels 走同一条代码路径，但还没有被实际使用过。
- 在 TUI 助手里的引号处理尚未验证之前，`quoting: auto` 会原样插入路径。
- 已经开始的传输无法在文件中途打断：`workspace.fs.writeFile` 没有取消点，所以取消只会在文件之间
  停下。

[0.0.2]: https://github.com/chengww5217/pasteport/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/chengww5217/pasteport/releases/tag/v0.0.1
