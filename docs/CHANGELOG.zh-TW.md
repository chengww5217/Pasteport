# 變更日誌

<p align="center">
  <a href="../CHANGELOG.md">English</a> ·
  <a href="CHANGELOG.zh-CN.md">简体中文</a> ·
  <strong>繁體中文</strong> ·
  <a href="CHANGELOG.ja.md">日本語</a>
</p>

本專案所有值得記錄的變更都寫在這裡。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/)，版本號遵循
[語意化版本](https://semver.org/lang/zh-TW/spec/v2.0.0.html)。

## [0.0.2] - 2026-08-27

### 新增

- 介面已本地化為簡體中文、繁體中文、日文、韓文、法文、德文、西班牙文、俄文與巴西葡萄牙文，並跟隨
  VS Code 自身的顯示語言。命令標題與設定說明來自 `package.nls.*.json`，對話框與通知來自
  `l10n/bundle.l10n.*.json`。日誌輸出刻意保持英文，因為錯誤報告要附上它。
- 翻譯後的文件：`docs/README.zh-CN.md`、`docs/README.zh-TW.md` 與 `docs/README.ja.md`，以及
  `docs/CHANGELOG.<locale>.md` 下對應語言的變更日誌，並在每份 README 與變更日誌的頂端互相連結。
  它們不會打進 vsix，商店顯示的是英文版。
- `Pasteport: Show Resolved Remote Directory`（顯示解析後的遠端目錄），可以直接看到一次貼上實際會使用的
  目錄；`pasteport.remoteDir` 設定的說明裡帶有一個指向它的連結，就放在輸入框旁。

### 變更

- Linux 上，暫存的剪貼簿圖片改放在按使用者隔離的目錄裡：系統暫存目錄下的 `pasteport-staging-<uid>`，
  並以 `0700` 權限建立。原來的固定名稱落在人人共用、全域可寫的 `/tmp` 裡：同一台機器上的其他使用者，
  要嘛能讀到路過的每一張截圖，要嘛能猜出那個只有毫秒級時間戳的檔名，提前建好目錄埋下一個符號連結。
  macOS 和 Windows 本來就給每個使用者私有的暫存目錄，那邊沒有變化。`Pasteport: Diagnose` 會印出
  正在使用的路徑。
- `pasteport.remoteDir` 的預設值改為空，意思是自動偵測。遠端主機自己的 `TMPDIR` 透過
  `workspace.fs` 從遠端伺服器行程的環境（`/proc/self/environ`）中讀出，讀不到則退回 `/tmp` 與
  `/var/tmp` 中先存在的那個，再退回 `/tmp` 並記錄一條警告。檔案落在所選目錄的 `pasteport` 子目錄
  下。主機把 `TMPDIR` 指向別處時，現在會依照主機的設定來，而不是被忽略；明確設定該值則完全跳過偵測。
  偵測不過是幾次讀取，每個遠端主機、每個工作階段只做一次。
- `pasteport.remoteDir` 現在是使用者層級設定，和其他設定一樣可以被您開啟的工作區覆寫，因此儲存庫可以
  決定您的貼上會落到哪裡。設定說明與 README 都提醒：只在您信任的工作區裡貼上。
- `Pasteport: Diagnose` 會同時報告設定的遠端目錄與解析後的遠端目錄。

### 修正

- 傳輸進行中按貼上鍵不再毫無反應：擴充功能自己的處理會被放棄，但按鍵仍像以往一樣傳給終端機。
- 之前，剪貼簿讀取器一旦拋出例外，貼上鍵就會被吞掉；現在這種例外（正常情況下讀取器都會回傳錯誤負載，
  而不是拋例外）會讓按鍵照常傳給終端機。
- 遠端目錄偵測有了逾時上限，而且只有主機真的回答了才會記住結果。在遠端檔案系統尚未就緒時跑過的
  偵測，不會再把 `/tmp` 固定成整個工作階段的結果；半死的連線也不會再讓貼上命令永遠等下去。
- 遠端檔名中的反引號與 `$` 會被去掉，所以名為 ``x`id`.png`` 的檔案不會再把命令替換帶進提示字元。
  其他 shell 中介字元保持原樣 —— `(` 與 `)` 在截圖名稱裡很常見 —— 因此原樣貼上的名稱在交給 shell
  解析時仍可能需要 `quoting: shell`。
- Windows 讀取器在暫存圖片前會先驗證內容：剪貼簿裡有些資料雖然被標記為 `PNG`，位元組卻未必真的是
  PNG（不少應用程式會把其他資料標成 PNG 格式），一旦驗證不過，就改用剪貼簿裡的點陣圖重新產生一份
  真正的 PNG —— Linux 讀取器從一開始就是這樣做的；讀過的剪貼簿資料流也會被釋放。
- Linux 安裝小幫手改用找到的絕對路徑來啟動套件管理器與 `pkexec`，因為該命令以 root 身分執行。
- 裝著數千個檔案的剪貼簿不會再讓讀取器死於 `ENOBUFS`：輸出上限從 1 MB 提到 8 MB。那條管線裡傳的
  只有路徑，從來不是圖片位元組。
- `release.yml` 透過環境變數把標籤版本號傳給 shell，而不是內插進命令列。

## [0.0.1] - 2026-08-24

已發佈於 [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=chengww.pasteport)
與 [Open VSX](https://open-vsx.org/extension/chengww/pasteport)。

### 新增

- 把 macOS 剪貼簿裡的圖片與檔案貼進 VS Code 遠端視窗的終端機；遠端路徑會插入到提示字元處。
- 透過 `workspace.fs` 傳輸，URI 借自視窗本身，因此每種遠端後端都走同一條程式碼路徑。已在
  Remote - SSH 上端到端驗證。
- 依指紋去重：8 MB 以內用內容 SHA-256，超過則用 `size:mtime:name`。遠端已存在且大小正確的副本會被
  重複使用，而不是重傳。
- 從第一毫秒起就顯示狀態列進度；對預估超過 `pasteport.confirmAboveSeconds` 的傳輸，會先彈確認對話
  框，再顯示可取消的通知 —— 預估基於你自己連線上實測的吞吐量。
- 對已上傳檔案與本機暫存圖片做 TTL 清理，啟動時在背景執行，也可透過
  `Pasteport: Clean Up Remote Files` 手動觸發。
- `Pasteport: Diagnose`，報告一次成功貼上所依賴的每一個條件。
- 設定項：`remoteDir`、`quoting`、`trailingSpace`、`confirmAboveSeconds`、`ttlHours`、
  `bracketedPaste`。
- Windows 用戶端支援：一個 PowerShell 讀取器，剪貼簿有 PNG 格式時取它，否則取點陣圖，繫結到
  <kbd>Ctrl</kbd>+<kbd>V</kbd>。
- Linux 用戶端支援：Wayland 上用 `wl-paste`，X11 上用 `xclip`，處理 `text/uri-list` 與
  `x-special/gnome-copied-files`，繫結到 <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd>。
- Linux 剪貼簿工具缺失時提供安裝：命令會在執行前展示出來，提權走 `pkexec` 以便由桌面自己彈出驗證
  提示，不受支援的發行版與原始碼發行版會被告知該執行什麼，而不是替它們亂猜。
- 把 `pasteport.paste` 貢獻進 `terminal.integrated.commandsToSkipShell`，否則 Windows 上的貼上鍵
  會被送進 shell，永遠到不了擴充功能。
- 一個擴充功能圖示，打包時由 `scripts/build.mjs` 從 `assets/icon.svg` 點陣化產生；儲存庫裡不提交
  任何圖片。
- 用 esbuild 打包：擴充功能以單一壓縮後的 `dist/build/extension.js` 發佈，vsix 裡既沒有測試也沒有
  source map。

### 已知限制

- Windows 與 Linux 讀取器還沒有在真實桌面工作階段中被人用過；兩者都有單元測試涵蓋，Windows 那個還在
  CI 裡對著真實的 PowerShell 跑。
- PowerShell 的啟動成本在真實硬體上尚未實測。它落在每一次貼上上，包括純文字貼上；探測超過 150ms 時
  擴充功能會記錄一條警告。
- 後端只驗證過 Remote - SSH；Dev Containers、WSL 與 Tunnels 走同一條程式碼路徑，但還沒有被實際
  使用過。
- 在 TUI 助手裡的引號處理尚未驗證之前，`quoting: auto` 會原樣插入路徑。
- 已經開始的傳輸無法在檔案中途打斷：`workspace.fs.writeFile` 沒有取消點，所以取消只會在檔案之間
  停下。

[0.0.2]: https://github.com/chengww5217/pasteport/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/chengww5217/pasteport/releases/tag/v0.0.1
