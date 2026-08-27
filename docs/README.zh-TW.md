# Pasteport

<p align="center">
  <img src="../assets/icon.svg" alt="Pasteport 圖示" width="128" />
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=chengww.pasteport"><img src="https://badgen.net/vs-marketplace/v/chengww.pasteport?label=VS%20Code%20Marketplace" alt="VS Code Marketplace 版本" /></a>
  <a href="https://open-vsx.org/extension/chengww/pasteport"><img src="https://img.shields.io/open-vsx/v/chengww/pasteport?label=Open%20VSX" alt="Open VSX 版本" /></a>
</p>

<p align="center">
  <a href="../README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <strong>繁體中文</strong> ·
  <a href="README.ja.md">日本語</a>
</p>

在 VS Code **遠端視窗**的終端機裡按下貼上鍵，本機剪貼簿中的圖片或檔案就會傳送到遠端主機 ——
接著**遠端路徑**會被寫進你的提示字元，命令列 AI 助手可以直接讀取。

```
$ claude "這張截圖有什麼問題？" /tmp/pasteport/9f2c1a4b7e0d3856/clipboard.png
                               └── 按下貼上鍵時出現的
```

在本機視窗裡什麼都不會變：按鍵會原封不動交還給終端機，所以這個快速鍵可以一直綁著。

## 它能處理什麼

| 剪貼簿內容                         | 結果                               |
| ---------------------------------- | ---------------------------------- |
| 截圖或複製的圖片                   | 暫存為 PNG、上傳、插入遠端路徑     |
| 在檔案管理器中複製的一個或多個檔案 | 以原檔名上傳，插入各自的路徑       |
| 文字、空剪貼簿、複製的資料夾       | 什麼都不做 —— 執行終端機原本的貼上 |

多個檔案之間以空格分隔，結尾也會補一個空格，方便你繼續輸入。

## 環境需求

- **macOS、Windows 或 Linux 用戶端。** 擴充功能執行在你的本機上，並在那裡讀取原生剪貼簿。每個平台都有
  各自的讀取器；哪些已在實機上驗證過，見[平台支援](#平台支援)。
- **僅 Linux 需要一個剪貼簿工具：** Wayland 用 `wl-clipboard`，X11 用 `xclip`。兩者都不隨擴充功能打包。
  若缺少，第一次貼上時會提議安裝：先顯示確切的命令，再由你的桌面透過自身的 polkit 提示要求授權。
  若你拒絕，命令會留給你自己執行。
- **VS Code 1.85 或更新版本**，以及一個遠端視窗（本機視窗不是本擴充功能的目標情境）。
- 遠端主機上不需要安裝任何東西。

## 遠端後端

傳輸走 VS Code 既有的連線：使用 `workspace.fs`，並借用視窗本身的一個 URI。scheme 與 authority 都沿用它，
因此所有後端走的是同一條程式碼路徑，沒有需要維護的分後端邏輯。

| 後端                 | 狀態               |
| -------------------- | ------------------ |
| Remote - SSH         | 已完整驗證         |
| Dev Containers       | 預期可用，尚未驗證 |
| WSL                  | 預期可用，尚未驗證 |
| Tunnels / Codespaces | 預期可用，尚未驗證 |

「尚未驗證」就是字面意思：程式碼路徑完全相同，但只有 SSH 被實際測量與使用過。歡迎回報其他後端的情況。

## 運作方式

擴充功能宣告了 `"extensionKind": ["ui"]`，也就是說它執行在你本機的**本機**擴充功能主機中，而不是遠端主機上。
由此帶來兩個結果，而它們正是這個擴充功能如此設計的原因：

- **它讀取的是真正的剪貼簿。** 在 Finder 或檔案總管裡複製的檔案，在剪貼簿上是 file URL —— 這種格式
  webview 裡的非同步剪貼簿 API 從來不會提供。直接讀取原生剪貼簿，才讓「複製一個檔案，在終端機裡貼上」
  這件事成立。
- **位元組只走一跳。** 檔案從本機磁碟讀出，透過 VS Code 既有的通道寫出。沒有跨 RPC 邊界的 base64 往返，
  途中不會被放大。剩下的唯一上限是記憶體：`workspace.fs.writeFile` 接受的是一個 buffer，因此每個檔案在
  傳送期間都留在擴充功能主機裡。截圖與壓縮檔不受影響；幾 GB 的大檔案不是本擴充功能的用途。

每次貼上都會讀一次剪貼簿，純文字貼上也一樣，所以這份成本會表現為輸入延遲。在 macOS 上它是一次
`osascript`（JXA）對 AppKit 的呼叫，實測約 **30ms** —— 低於讓人覺得按鍵變慢的門檻。若某次探測超過
150ms，擴充功能會記錄一則警告，因為到那個程度讀取器就該改成常駐處理程序了。

### 為什麼不用 scp

在開發時所用的連線上實測：

| 資料量 | 經 `workspace.fs`  | 本機基準（`file:`） |
| ------ | ------------------ | ------------------- |
| 1 MB   | 268ms（3.7 MB/s）  | —                   |
| 8 MB   | 2315ms（3.5 MB/s） | 10ms（800 MB/s）    |

3.5 MB/s 對本機 800 MB/s，說明瓶頸在網路連線而不是 API。scp 走的是同一條連線，繼承同樣的上限，所以加上它
換不到速度 —— 只會多出主機名稱解析、金鑰與 agent 處理、`ProxyJump` 支援，以及一整套連線生命週期要維護。
傳輸通道只有 `workspace.fs`，而 Dev Containers、WSL 和 Tunnels 也因此順帶全部支援。

### 去重

檔案落在 `<remoteDir>/<fingerprint>/<原檔名>`。上傳前會用一次 `stat` 檢查目標：如果它已經在那裡且大小
正確，就不傳輸任何位元組，直接插入既有路徑。第二次貼上同一張截圖只花一個往返。

指紋在 8 MB 以內是內容雜湊（SHA-256），超過則是 `size:mtime:name` —— 對幾百 MB 做雜湊的代價，比它消除的
碰撞風險更大。

### 進度與取消

每次傳輸從第一毫秒起，狀態列就會出現一個轉圈圖示。它唯一的職責是回答「是不是卡住了」—— 真正的完成訊號
是路徑出現在你的提示字元裡。

如果預估耗時超過 `pasteport.confirmAboveSeconds`（預設 5 秒），會先徵求你的同意，接著進度會移到帶取消
按鈕的通知裡。這個預估值來自你連線上實測的吞吐量，因此門檻會自動適應，而不是猜一個位元組數。任何時候都
可以使用命令 `Pasteport: Cancel Transfer`。

### 清理

上傳的檔案與本機暫存的圖片超過 `pasteport.ttlHours`（預設 24 小時）後，會在啟動時於背景被清除，也可以
透過 `Pasteport: Clean Up Remote Files` 手動觸發。

從剪貼簿取出的圖片，暫存在系統暫存目錄下的 `pasteport-staging` 資料夾裡。Linux 上那就是共用的
`/tmp`，所以資料夾名帶上了您的 uid，並以 `0700` 權限建立，共用機器上的其他使用者進不去、也讀不到
裡面的內容。`Pasteport: Diagnose` 會印出確切路徑。

清理只會刪除名稱符合擴充功能自身指紋格式（16 個十六進位字元）的目錄，以及符合自身命名規則的暫存圖片。
`remoteDir` 下的其他內容只會被計數並原樣留下，因此把這個設定指向共用目錄，也不會讓清理造成連帶損害。

## 命令

| 命令                                    | 作用                               |
| --------------------------------------- | ---------------------------------- |
| `Pasteport: Paste into Remote Terminal` | 快速鍵綁定的目標，也可手動執行     |
| `Pasteport: Cancel Transfer`            | 中止進行中的傳輸                   |
| `Pasteport: Clean Up Remote Files`      | 立刻執行一次過期清理               |
| `Pasteport: Diagnose`                   | 把環境資訊和一次剪貼簿探測寫入記錄 |

如果哪裡不對，先執行 `Pasteport: Diagnose` —— 它會回報一次成功貼上所依賴的每個條件，這讓問題回報容易
處理得多。

## 設定

| 設定項目                        | 預設值   | 說明                                                 |
| ------------------------------- | -------- | ---------------------------------------------------- |
| `pasteport.remoteDir`           | _(留空)_ | 遠端主機上的絕對 POSIX 目錄；留空表示自動偵測        |
| `pasteport.quoting`             | `auto`   | `auto`、`shell`（為特殊字元加引號）或 `none`（原樣） |
| `pasteport.trailingSpace`       | `true`   | 在插入的路徑後加一個空格                             |
| `pasteport.confirmAboveSeconds` | `5`      | 預估耗時超過該秒數則先詢問；`0` 表示永不詢問         |
| `pasteport.ttlHours`            | `24`     | 貼上的檔案保留多少小時後被清理；`0` 表示停用         |
| `pasteport.bracketedPaste`      | `false`  | 以括號貼上標記包住插入內容                           |

`pasteport.remoteDir` 的範圍是「機器」：可以依使用者或依機器設定，但不能依工作區設定。它的值會被寫進你的
終端機，所以不允許由某個儲存庫決定。`~` 不會展開 —— `workspace.fs` 不解析它，那樣只會建立一個名稱就叫
`~` 的目錄。

### 檔案落在哪裡

留空時，`pasteport.remoteDir` 會從遠端主機問出來，而不是假定為 `/tmp`：主機完全有權把 `TMPDIR` 指到別處，
而給 AI 助手讀的暫時檔案，就該待在那台主機認定的暫時檔案位置。

擴充功能沒有辦法在遠端側執行命令 —— 它活在本機擴充功能主機裡。它有的是 `workspace.fs`，其讀取由遠端伺服器
處理程序提供，因此 `/proc/self/environ` 就是那個處理程序自己的環境。而該伺服器是從你的登入環境啟動的，
所以它的 `TMPDIR` 正是主機實際設定的值。解析順序：

1. 遠端伺服器環境中的 `TMPDIR`，其次 `TMP`，再次 `TEMP` —— 適用於 Linux 遠端，也就是 SSH 到 Linux、
   Dev Containers、WSL、Tunnels 和 Codespaces。
2. `/tmp` 與 `/var/tmp` 中第一個存在的 —— 適用於沒有 procfs 的遠端，例如 macOS。
3. `/tmp`，同時在記錄中寫下一則警告。

接著檔案會落在所選目錄下的 `pasteport` 子目錄中，寫入與清理也只涉及這個子目錄。結果每台主機記錄一次，
並由 `Pasteport: Diagnose` 回報，所以貼上去了哪裡從來不是問題。明確設定該值則完全跳過偵測。

有兩件事它解決不了。在與他人共用的遠端主機上，`TMPDIR` 通常就是 `/tmp`，於是 `/tmp/pasteport` 屬於第一個
貼上的人，之後的使用者會遇到權限錯誤 —— 請把 `pasteport.remoteDir` 設到你自己的位置，例如家目錄底下。
另外，偵測假定遠端是 POSIX 系統：所有支援的後端都是 Linux 或 macOS，而 Windows 遠端需要的是這裡任何部分
都不理解的路徑形式。

關於 `quoting`：目標是把你的輸入當成純文字處理的 TUI 助手，在那裡一個引號會變成路徑的一部分，並悄悄讓它
失效。所以 `auto` 目前是原樣插入路徑。如果你主要是貼給會解析這一行的 shell，請選 `shell`。

## 快速鍵

使用各平台自己的終端機貼上鍵，且僅在終端機取得焦點時生效。除非剪貼簿上有圖片或檔案，這個鍵的行為和以前
完全一樣。

| 平台    | 按鍵                                          | 備註                                                                                |
| ------- | --------------------------------------------- | ----------------------------------------------------------------------------------- |
| macOS   | <kbd>Cmd</kbd>+<kbd>V</kbd>                   | —                                                                                   |
| Windows | <kbd>Ctrl</kbd>+<kbd>V</kbd>                  | —                                                                                   |
| Linux   | <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd> | 沿用終端機慣例；<kbd>Ctrl</kbd>+<kbd>V</kbd> 是 readline 的 `quoted-insert`，不動它 |

在 Windows 和 Linux 上，終端機取得焦點時按下的鍵通常會直接送給 shell，因此 `pasteport.paste` 被加入了
`terminal.integrated.commandsToSkipShell` —— 這個清單是疊加在 VS Code 內建清單之上的，你原有的習慣不會
改變。如果你在自己的設定裡寫了 `commandsToSkipShell` 陣列，它會取代預設值，此時擴充功能會提議為你新增
一次這一項。

想換別的按鍵，在鍵盤快速鍵中重新綁定 `pasteport.paste` 即可。

## 平台支援

三個讀取器是彼此獨立的程式，除了一份很小的 JSON 約定之外沒有共用程式碼 —— 因為這些平台的 API 本身也毫無
共同之處。

| 用戶端  | 讀取器                                      | 狀態                                            |
| ------- | ------------------------------------------- | ----------------------------------------------- |
| macOS   | `osascript`（JXA）呼叫 AppKit               | 已在實機驗證：截圖、僅 TIFF 的複製、Finder 檔案 |
| Windows | `powershell -STA` 呼叫 System.Windows.Forms | 在 Windows CI runner 上執行；尚未在真實桌面驗證 |
| Linux   | `wl-paste`（Wayland）/ `xclip`（X11）       | 格式處理有單元測試；尚未在真實桌面驗證          |

有兩點確實還沒測：PowerShell 的啟動比 `osascript` 慢一個數量級，而這份成本落在每一次貼上上；擴充功能在
超過 150ms 時會記錄警告，所以如果 Windows 上的輸入手感變鈍，記錄會告訴你，屆時讀取器需要改成常駐處理程序。
另外，Windows 和 Linux 的讀取器都還沒有人在真實桌面工作階段裡實際用過 —— 歡迎回報。

## 參與貢獻

見 [CONTRIBUTING.md](../CONTRIBUTING.md)。附上 `Pasteport: Diagnose` 輸出的問題回報最有價值。

## 授權

[MIT](../LICENSE)
