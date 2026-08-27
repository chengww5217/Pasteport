# Pasteport

<p align="center">
  <img src="../assets/icon.svg" alt="Pasteport 图标" width="128" />
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=chengww.pasteport"><img src="https://badgen.net/vs-marketplace/v/chengww.pasteport?label=VS%20Code%20Marketplace" alt="VS Code Marketplace 版本" /></a>
  <a href="https://open-vsx.org/extension/chengww/pasteport"><img src="https://img.shields.io/open-vsx/v/chengww/pasteport?label=Open%20VSX" alt="Open VSX 版本" /></a>
</p>

<p align="center">
  <a href="../README.md">English</a> ·
  <strong>简体中文</strong> ·
  <a href="README.zh-TW.md">繁體中文</a> ·
  <a href="README.ja.md">日本語</a>
</p>

在 VS Code **远程窗口**的终端里按下粘贴键，本机剪贴板中的图片或文件就会被送到远程主机 —— 随后
**远程路径**被写入你的提示符，命令行 AI 助手可以直接读取。

```
$ /tmp/pasteport/9f2c1a4b7e0d3856/clipboard.png
  └── 按下粘贴键时出现的
```

<p align="center">
  <img src="../assets/demo.gif" alt="演示：截图后在远程终端里按下粘贴键，图片被上传，远程路径插入提示符" width="800" />
</p>

本地窗口里什么都不会变：按键会被原样交还给终端，所以这个快捷键可以放心地一直绑着。

## 它能处理什么

| 剪贴板内容                         | 结果                             |
| ---------------------------------- | -------------------------------- |
| 截图或复制的图片                   | 暂存为 PNG、上传、插入远程路径   |
| 在文件管理器中复制的一个或多个文件 | 以原文件名上传，插入各自的路径   |
| 文本、空剪贴板、复制的文件夹       | 什么都不做 —— 执行终端原本的粘贴 |

多个文件之间以空格分隔，末尾也会补一个空格，方便你继续输入。

## 环境要求

- **macOS、Windows 或 Linux 客户端。** 扩展运行在你的本机上，并在那里读取原生剪贴板。每个平台都有
  各自的读取器；哪些已在真机上验证过，见[平台支持](#平台支持)。
- **仅 Linux 需要一个剪贴板工具：** Wayland 用 `wl-clipboard`，X11 用 `xclip`。两者都不随扩展打包。
  若缺失，第一次粘贴时会提议安装：先展示确切的命令，再由你的桌面通过自身的 polkit 提示请求授权。
  拒绝的话，命令会留给你自己执行。
- **VS Code 1.85 或更高版本**，以及一个远程窗口（本地窗口不是本扩展的目标场景）。
- 远程主机上无需安装任何东西。

## 远程后端

传输走 VS Code 已经建立好的连接：使用 `workspace.fs`，并借用窗口本身的一个 URI。scheme 与 authority
都沿用它，因此所有后端走的是同一条代码路径，不存在需要维护的分后端逻辑。

| 后端                 | 状态               |
| -------------------- | ------------------ |
| Remote - SSH         | 已完整验证         |
| Dev Containers       | 预期可用，尚未验证 |
| WSL                  | 预期可用，尚未验证 |
| Tunnels / Codespaces | 预期可用，尚未验证 |

「尚未验证」就是字面意思：代码路径完全相同，但只有 SSH 被实际测量和使用过。欢迎反馈其他后端的情况。

## 工作原理

扩展声明了 `"extensionKind": ["ui"]`，也就是说它运行在你本机的**本地**扩展宿主中，而不是远程主机上。
由此带来两个结果，它们正是这个扩展如此设计的原因：

- **它读取的是真正的剪贴板。** 在 Finder 或资源管理器里复制的文件，在剪贴板上表现为 file URL —— 这种
  格式 webview 里的异步剪贴板 API 从来不会暴露。直接读取原生剪贴板，才让「复制一个文件，在终端里粘贴」
  这件事成立。
- **字节只走一跳。** 文件从本地磁盘读出，通过 VS Code 已有的通道写出。没有跨 RPC 边界的 base64 往返，
  途中不会被撑大。剩下的唯一上限是内存：`workspace.fs.writeFile` 接受的是一个 buffer，因此每个文件在
  发送期间都留在扩展宿主里。截图和压缩包没有影响；几个 GB 的大文件不是本扩展的用途。

每次粘贴都会读一次剪贴板，纯文本粘贴也一样，所以这份开销会体现为输入延迟。在 macOS 上它是一次
`osascript`（JXA）对 AppKit 的调用，实测约 **30ms** —— 低于让人觉得按键变慢的阈值。若某次探测超过
150ms，扩展会记录一条警告，因为到那个程度读取器就该改成常驻进程了。

### 为什么不用 scp

在开发时所用的链路上实测：

| 数据量 | 经 `workspace.fs`  | 本地基准（`file:`） |
| ------ | ------------------ | ------------------- |
| 1 MB   | 268ms（3.7 MB/s）  | —                   |
| 8 MB   | 2315ms（3.5 MB/s） | 10ms（800 MB/s）    |

3.5 MB/s 对本地 800 MB/s，说明瓶颈在网络链路而非 API。scp 走的是同一条链路，继承同样的上限，所以加上它
换不来速度 —— 只会多出主机名解析、密钥与 agent 处理、`ProxyJump` 支持，以及一套连接生命周期要维护。
传输通道只有 `workspace.fs`，而 Dev Containers、WSL 和 Tunnels 也因此顺带全都支持了。

### 去重

文件落在 `<remoteDir>/<fingerprint>/<原文件名>`。上传前会用一次 `stat` 检查目标：如果它已经在那里且大小
正确，就不传输任何字节，直接插入已有路径。第二次粘贴同一张截图只花一个往返。

指纹在 8 MB 以内是内容哈希（SHA-256），超过则是 `size:mtime:name` —— 对几百 MB 做哈希的代价，比它消除的
碰撞风险更大。

### 进度与取消

每次传输从第一毫秒起，状态栏就会出现一个转圈图标。它唯一的职责是回答「是不是卡住了」—— 真正的完成信号
是路径出现在你的提示符里。

如果预计耗时超过 `pasteport.confirmAboveSeconds`（默认 5 秒），会先征求你的同意，随后进度会移到带取消
按钮的通知里。这个预计值来自你链路上实测的吞吐，因此阈值会自适应，而不是靠猜一个字节数。任何时候都可以
使用命令 `Pasteport: Cancel Transfer`。

### 清理

上传的文件和本地暂存的图片超过 `pasteport.ttlHours`（默认 24 小时）后，会在启动时于后台被清除，也可以
通过 `Pasteport: Clean Up Remote Files` 手动触发。

从剪贴板取出的图片，暂存在系统临时目录下的 `pasteport-staging` 文件夹里。Linux 上那就是共享的
`/tmp`，所以文件夹名带上了你的 uid，并以 `0700` 权限创建，共享机器上的其他用户进不去、也读不到
里面的内容。`Pasteport: Diagnose` 会打印确切路径。

清理只会删除名字符合扩展自身指纹格式（16 个十六进制字符）的目录，以及符合自身命名规则的暂存图片。
`remoteDir` 下的其他内容只会被计数并原样留下，因此把这个设置指向一个共享目录，也不会让清理造成连带损害。

## 命令

| 命令                                    | 作用                               |
| --------------------------------------- | ---------------------------------- |
| `Pasteport: Paste into Remote Terminal` | 快捷键绑定的目标，也可手动执行     |
| `Pasteport: Cancel Transfer`            | 中止正在进行的传输                 |
| `Pasteport: Clean Up Remote Files`      | 立即执行一次过期清理               |
| `Pasteport: Diagnose`                   | 把环境信息和一次剪贴板探测写入日志 |

如果哪里不对，先运行 `Pasteport: Diagnose` —— 它会报告一次成功粘贴所依赖的每个条件，这让问题反馈容易
处理得多。

## 设置

| 设置项                          | 默认值   | 说明                                                 |
| ------------------------------- | -------- | ---------------------------------------------------- |
| `pasteport.remoteDir`           | _(留空)_ | 远程主机上的绝对 POSIX 目录；留空表示自动检测        |
| `pasteport.quoting`             | `auto`   | `auto`、`shell`（为特殊字符加引号）或 `none`（原样） |
| `pasteport.trailingSpace`       | `true`   | 在插入的路径后加一个空格                             |
| `pasteport.confirmAboveSeconds` | `5`      | 预计耗时超过该秒数则先询问；`0` 表示从不询问         |
| `pasteport.ttlHours`            | `24`     | 粘贴的文件保留多少小时后被清理；`0` 表示禁用         |
| `pasteport.bracketedPaste`      | `false`  | 用括号粘贴标记包裹插入内容                           |

`pasteport.remoteDir` 是用户级设置，和其他用户设置一样，可以被你打开的工作区覆盖。它的值会直接写进
你的终端，所以克隆来的仓库也能决定你的粘贴落到哪里——请只在你信任的工作区里粘贴。`~` 不会被展开 ——
`workspace.fs` 不解析它，那样只会创建一个名字就叫`~` 的目录。

### 文件落在哪里

留空时，`pasteport.remoteDir` 会从远程主机上问出来，而不是假定为 `/tmp`：主机完全有权把 `TMPDIR` 指到
别处，而给 AI 助手读的临时文件，就该待在那台主机认定的临时文件位置。

扩展没有办法在远程侧执行命令 —— 它活在本地扩展宿主里。它有的是 `workspace.fs`，其读取由远程服务器进程
提供，因此 `/proc/self/environ` 就是那个进程自己的环境。而该服务器是从你的登录环境启动的，所以它的
`TMPDIR` 正是主机实际配置的值。解析顺序：

1. 远程服务器环境中的 `TMPDIR`，其次 `TMP`，再次 `TEMP` —— 适用于 Linux 远端，也就是 SSH 到 Linux、
   Dev Containers、WSL、Tunnels 和 Codespaces。
2. `/tmp` 与 `/var/tmp` 中第一个存在的 —— 适用于没有 procfs 的远端，比如 macOS。
3. `/tmp`，同时在日志中记录一条警告。

然后文件会落在所选目录下的 `pasteport` 子目录中，写入和清理也只涉及这个子目录。结果每台主机记录一次日志，
并由 `Pasteport: Diagnose` 报告，所以粘贴去了哪里从来不是问题。显式设置该值则完全跳过检测。

有两件事它解决不了。在与他人共用的远程主机上，`TMPDIR` 通常就是 `/tmp`，于是 `/tmp/pasteport` 属于第一个
粘贴的人，之后的用户会遇到权限错误 —— 请把 `pasteport.remoteDir` 设到你自己的位置，比如家目录下面。另外，
检测假定远端是 POSIX 系统：所有受支持的后端都是 Linux 或 macOS，而 Windows 远端需要的是这里任何部分都不
理解的路径形式。

关于 `quoting`：目标是把你的输入当作纯文本处理的 TUI 助手，在那里一个引号会变成路径的一部分，并悄悄让它
失效。所以 `auto` 目前是原样插入路径。如果你主要是粘给会解析这行内容的 shell，请选 `shell`。

## 快捷键

使用各平台自己的终端粘贴键，且仅在终端获得焦点时生效。除非剪贴板上有图片或文件，这个键的行为和以前
完全一样。

| 平台    | 按键                                          | 备注                                                                              |
| ------- | --------------------------------------------- | --------------------------------------------------------------------------------- |
| macOS   | <kbd>Cmd</kbd>+<kbd>V</kbd>                   | —                                                                                 |
| Windows | <kbd>Ctrl</kbd>+<kbd>V</kbd>                  | —                                                                                 |
| Linux   | <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd> | 沿用终端惯例；<kbd>Ctrl</kbd>+<kbd>V</kbd> 是 readline 的 `quoted-insert`，不动它 |

在 Windows 和 Linux 上，终端获得焦点时按下的键通常会直接发给 shell，因此 `pasteport.paste` 被加入了
`terminal.integrated.commandsToSkipShell` —— 这个列表是叠加在 VS Code 内置列表之上的，你原有的习惯不会
改变。如果你在自己的设置里写了 `commandsToSkipShell` 数组，它会替换默认值，此时扩展会提议为你添加一次
这一项。

想换别的键，在键盘快捷方式里重新绑定 `pasteport.paste` 即可。

## 平台支持

三个读取器是彼此独立的程序，除了一份很小的 JSON 约定之外没有共用代码 —— 因为这些平台的 API 本身也毫无
共同之处。

| 客户端  | 读取器                                      | 状态                                            |
| ------- | ------------------------------------------- | ----------------------------------------------- |
| macOS   | `osascript`（JXA）调用 AppKit               | 已在真机验证：截图、仅 TIFF 的复制、Finder 文件 |
| Windows | `powershell -STA` 调用 System.Windows.Forms | 在 Windows CI runner 上运行；尚未在真实桌面验证 |
| Linux   | `wl-paste`（Wayland）/ `xclip`（X11）       | 格式处理有单元测试；尚未在真实桌面验证          |

有两点确实还没测：PowerShell 的启动比 `osascript` 慢一个数量级，而这份开销落在每一次粘贴上；扩展在超过
150ms 时会记录警告，所以如果 Windows 上的输入手感发滞，日志会告诉你，届时读取器需要改成常驻进程。另外，
Windows 和 Linux 的读取器都还没有人在真实桌面会话里实际用过 —— 欢迎反馈。

## 参与贡献

见 [CONTRIBUTING.md](../CONTRIBUTING.md)。附上 `Pasteport: Diagnose` 输出的问题反馈最有价值。

## 许可

[MIT](../LICENSE)
