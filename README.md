# xCode

## English

**English** · [Русский](#русский) · [简体中文](#简体中文)

xCode is a Claude Code–based terminal coding agent with a React/Ink interface and native streaming through the OpenAI Responses API. It can read and edit files, search a codebase, run shell commands, delegate tasks to subagents, and connect to MCP servers.

### Support xCode

[Donate via CloudTips](https://pay.cloudtips.ru/p/fb925110)

<details>
<summary>Crypto donations</summary>

| Bitcoin (BTC) | TON / USDT on TON | ETH (Ethereum only) |
| :---: | :---: | :---: |
| <img src="assets/donate-btc.png" width="140" alt="Bitcoin address QR code"> | <img src="assets/donate-ton.png" width="140" alt="TON network address QR code"> | <img src="assets/donate-eth.png" width="140" alt="Ethereum address QR code"> |

- **Bitcoin:** `bc1q0d2j8zgrfnr33j83y9hza3mk0py8xtpzg5wxxv`
- **TON network:** `UQA_zsyjS1uVC4r0aGfCiY6skZvMsqeeUb7K425eq42KYVai`
- **Ethereum:** `0xD6dc71Eba770A4527a94FBa9D369cf6f2B2CFB15`

For the TON address, select Toncoin (TON) or USDT in your wallet before sending. Use the TON network for USDT, not Ethereum or Tron.

</details>

### Install

**Linux / macOS**

```sh
installer="$(curl -fsSL https://github.com/xyzmean/xcode/releases/latest/download/install.sh)" && sh -c "$installer"
```

**Windows (PowerShell)**

```powershell
& { $f = New-TemporaryFile; try { Invoke-WebRequest -UseBasicParsing 'https://github.com/xyzmean/xcode/releases/latest/download/install.ps1' -OutFile $f.FullName -ErrorAction Stop; & ([scriptblock]::Create([IO.File]::ReadAllText($f.FullName))) } finally { Remove-Item -LiteralPath $f.FullName -Force } }
```

The installers select x64 or ARM64 and verify the binary’s SHA-256. You can also download the binary directly from [GitHub Releases](https://github.com/xyzmean/xcode/releases). Install [ripgrep](https://github.com/BurntSushi/ripgrep#installation) for file search.

### Run from source

You’ll need [Bun](https://bun.sh) 1.3+, [ripgrep](https://github.com/BurntSushi/ripgrep#installation) on your `PATH`, and either a ChatGPT subscription or an OpenAI API key.

```sh
bun install
bun run src/entrypoints/cli.tsx auth login
bun run start
```

`auth login` uses ChatGPT Token Sharing by default. To use the Codex browser flow instead, run `bun run src/entrypoints/cli.tsx auth login --codex`. If `OPENAI_API_KEY` is set, skip login. OpenAI is the only supported model provider.

Use `/model` to switch models in the terminal, or start with `bun run start --model gpt-6.2-sol`. Click collapsed tool output to expand it, or press `Ctrl+O` to open the transcript. Set `CLAUDE_CODE_NO_FLICKER=0` to use native terminal scrollback instead of fullscreen mode.

### Configuration

| Setting | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Use an API key instead of ChatGPT OAuth. |
| `OPENAI_BASE_URL` | Override the Responses API base URL. |
| `OPENAI_MODEL` | Override the main model (default: `gpt-6.2-sol`). |
| `OPENAI_FAST_MODEL` | Override the model for auxiliary queries (default: `gpt-6.2-sol-fast`). |
| `OPENAI_SUBAGENT_MODEL` | Override the model used by subagents. |
| `CLAUDE_CONFIG_DIR` | Override the global configuration directory (default: `~/.xcode`). |

Run `bun run src/entrypoints/cli.tsx auth status` to check authentication. Replace `status` with `logout` to clear stored ChatGPT credentials; unset `OPENAI_API_KEY` separately if it is set. xCode does not import global settings from `~/.claude`, but still supports project-level `.claude/` settings.

### Build and test

```sh
bun run build
bun test script/openai.integration.test.ts
```

The integration suite uses a local Responses API fixture and does not require OpenAI credentials.

Standalone builds check [GitHub Releases](https://github.com/xyzmean/xcode/releases) at startup and every 30 minutes and verify the signed OTA manifest before installing. Run `xcode update` to check manually, or set `DISABLE_AUTOUPDATER=1` to turn off background checks. Restart xCode after installing an update.

Pushing a tag matching `v<version>` in `package.json` publishes binaries for all six platforms. Set the Actions secret `XCODE_OTA_SIGNING_KEY` to the Ed25519 private key matching the updater’s public key before tagging. Manual workflow runs build without publishing.

## Русский

[English](#english) · **Русский** · [简体中文](#简体中文)

xCode — терминальный агент для программирования на базе Claude Code, с интерфейсом на React/Ink и потоковыми ответами через OpenAI Responses API. Он умеет читать и редактировать файлы, искать по коду, запускать команды, делегировать задачи субагентам и подключаться к MCP-серверам.

### Поддержать xCode

[Поддержать через CloudTips](https://pay.cloudtips.ru/p/fb925110)

<details>
<summary>Донаты в криптовалюте</summary>

| Bitcoin (BTC) | TON / USDT в сети TON | ETH (только сеть Ethereum) |
| :---: | :---: | :---: |
| <img src="assets/donate-btc.png" width="140" alt="QR-код адреса Bitcoin"> | <img src="assets/donate-ton.png" width="140" alt="QR-код адреса в сети TON"> | <img src="assets/donate-eth.png" width="140" alt="QR-код адреса Ethereum"> |

- **Bitcoin:** `bc1q0d2j8zgrfnr33j83y9hza3mk0py8xtpzg5wxxv`
- **Сеть TON:** `UQA_zsyjS1uVC4r0aGfCiY6skZvMsqeeUb7K425eq42KYVai`
- **Ethereum:** `0xD6dc71Eba770A4527a94FBa9D369cf6f2B2CFB15`

Для адреса TON выберите в кошельке Toncoin (TON) или USDT перед отправкой. Для USDT используйте сеть TON, а не Ethereum или Tron.

</details>

### Установка

**Linux / macOS**

```sh
installer="$(curl -fsSL https://github.com/xyzmean/xcode/releases/latest/download/install.sh)" && sh -c "$installer"
```

**Windows (PowerShell)**

```powershell
& { $f = New-TemporaryFile; try { Invoke-WebRequest -UseBasicParsing 'https://github.com/xyzmean/xcode/releases/latest/download/install.ps1' -OutFile $f.FullName -ErrorAction Stop; & ([scriptblock]::Create([IO.File]::ReadAllText($f.FullName))) } finally { Remove-Item -LiteralPath $f.FullName -Force } }
```

Установщик выбирает x64 или ARM64 и проверяет SHA-256 бинарника. Бинарники также можно скачать напрямую со страницы [GitHub Releases](https://github.com/xyzmean/xcode/releases). Для поиска по файлам установите [ripgrep](https://github.com/BurntSushi/ripgrep#installation).

### Запуск из исходников

Понадобятся [Bun](https://bun.sh) 1.3+, [ripgrep](https://github.com/BurntSushi/ripgrep#installation) в `PATH` и подписка ChatGPT или ключ OpenAI API.

```sh
bun install
bun run src/entrypoints/cli.tsx auth login
bun run start
```

По умолчанию `auth login` использует ChatGPT Token Sharing. Для входа через Codex в браузере запустите `bun run src/entrypoints/cli.tsx auth login --codex`. Если задан `OPENAI_API_KEY`, вход не нужен. Поддерживаются только модели OpenAI.

Для смены модели используйте `/model` или запустите `bun run start --model gpt-6.2-sol`. Нажмите на свёрнутый вывод инструмента, чтобы развернуть его, или используйте `Ctrl+O`, чтобы открыть историю сеанса. Значение `CLAUDE_CODE_NO_FLICKER=0` включает обычную прокрутку терминала вместо полноэкранного режима.

### Настройки

| Переменная | Назначение |
| --- | --- |
| `OPENAI_API_KEY` | Использовать API-ключ вместо OAuth через ChatGPT. |
| `OPENAI_BASE_URL` | Задать базовый адрес Responses API. |
| `OPENAI_MODEL` | Задать основную модель (по умолчанию `gpt-6.2-sol`). |
| `OPENAI_FAST_MODEL` | Задать модель для вспомогательных запросов (по умолчанию `gpt-6.2-sol-fast`). |
| `OPENAI_SUBAGENT_MODEL` | Задать модель для субагентов. |
| `CLAUDE_CONFIG_DIR` | Задать каталог глобальных настроек (по умолчанию `~/.xcode`). |

Проверить авторизацию можно командой `bun run src/entrypoints/cli.tsx auth status`. Замените `status` на `logout`, чтобы удалить сохранённые данные входа в ChatGPT. Если задан `OPENAI_API_KEY`, удалите его из окружения отдельно. xCode не импортирует глобальные настройки из `~/.claude`, но поддерживает настройки проекта в `.claude/`.

### Сборка и тесты

```sh
bun run build
bun test script/openai.integration.test.ts
```

Интеграционные тесты используют локальный имитатор Responses API и не требуют учётных данных OpenAI.

Автономные сборки проверяют [GitHub Releases](https://github.com/xyzmean/xcode/releases) при запуске и каждые 30 минут. Перед установкой updater проверяет подпись манифеста. Для ручной проверки запустите `xcode update`; чтобы отключить фоновую проверку, задайте `DISABLE_AUTOUPDATER=1`. Перезапустите xCode после установки обновления.

Пуш тега `v<версия>`, совпадающего с версией в `package.json`, публикует бинарники для всех шести платформ. Перед отправкой тега добавьте в секрет Actions `XCODE_OTA_SIGNING_KEY` закрытый ключ Ed25519, соответствующий открытому ключу updater. Ручной запуск workflow выполняет сборку без публикации.

## 简体中文

[English](#english) · [Русский](#русский) · **简体中文**

xCode 是一个基于 Claude Code 的终端编程助手，采用 React/Ink 构建界面，并原生支持 OpenAI Responses API 的流式响应。它可以读写文件、搜索代码、运行命令、将任务委派给子代理，以及连接 MCP 服务器。

### 支持 xCode

[通过 CloudTips 捐赠](https://pay.cloudtips.ru/p/fb925110)

<details>
<summary>加密货币捐赠</summary>

| 比特币（BTC） | TON / USDT（TON 网络） | ETH（仅限以太坊网络） |
| :---: | :---: | :---: |
| <img src="assets/donate-btc.png" width="140" alt="比特币地址二维码"> | <img src="assets/donate-ton.png" width="140" alt="TON 网络地址二维码"> | <img src="assets/donate-eth.png" width="140" alt="以太坊地址二维码"> |

- **比特币：** `bc1q0d2j8zgrfnr33j83y9hza3mk0py8xtpzg5wxxv`
- **TON 网络：** `UQA_zsyjS1uVC4r0aGfCiY6skZvMsqeeUb7K425eq42KYVai`
- **以太坊：** `0xD6dc71Eba770A4527a94FBa9D369cf6f2B2CFB15`

向 TON 地址转账前，请在钱包中选择 Toncoin（TON）或 USDT。发送 USDT 时请选择 TON 网络，不要使用 Ethereum 或 Tron 网络。

</details>

### 安装

**Linux / macOS**

```sh
installer="$(curl -fsSL https://github.com/xyzmean/xcode/releases/latest/download/install.sh)" && sh -c "$installer"
```

**Windows (PowerShell)**

```powershell
& { $f = New-TemporaryFile; try { Invoke-WebRequest -UseBasicParsing 'https://github.com/xyzmean/xcode/releases/latest/download/install.ps1' -OutFile $f.FullName -ErrorAction Stop; & ([scriptblock]::Create([IO.File]::ReadAllText($f.FullName))) } finally { Remove-Item -LiteralPath $f.FullName -Force } }
```

安装脚本会自动选择 x64 或 ARM64 版本并验证二进制文件的 SHA-256。也可以直接从 [GitHub Releases](https://github.com/xyzmean/xcode/releases) 下载二进制文件。要使用文件搜索功能，请安装 [ripgrep](https://github.com/BurntSushi/ripgrep#installation)。

### 从源代码运行

你需要 [Bun](https://bun.sh) 1.3 或更高版本、已加入 `PATH` 的 [ripgrep](https://github.com/BurntSushi/ripgrep#installation)，以及 ChatGPT 订阅或 OpenAI API 密钥。

```sh
bun install
bun run src/entrypoints/cli.tsx auth login
bun run start
```

`auth login` 默认使用 ChatGPT Token Sharing。若要通过 Codex 在浏览器中登录，请运行 `bun run src/entrypoints/cli.tsx auth login --codex`。如果已设置 `OPENAI_API_KEY`，可跳过登录。目前仅支持 OpenAI 模型。

在终端中输入 `/model` 切换模型，或使用 `bun run start --model gpt-6.2-sol` 指定启动模型。点击折叠的工具输出即可展开，按 `Ctrl+O` 可查看会话记录。将 `CLAUDE_CODE_NO_FLICKER` 设为 `0` 可使用终端原生滚动，而不是全屏模式。

### 配置

| 环境变量 | 用途 |
| --- | --- |
| `OPENAI_API_KEY` | 使用 API 密钥代替 ChatGPT OAuth 登录。 |
| `OPENAI_BASE_URL` | 指定 Responses API 的基础地址。 |
| `OPENAI_MODEL` | 指定主模型（默认 `gpt-6.2-sol`）。 |
| `OPENAI_FAST_MODEL` | 指定辅助请求使用的模型（默认 `gpt-6.2-sol-fast`）。 |
| `OPENAI_SUBAGENT_MODEL` | 指定子代理使用的模型。 |
| `CLAUDE_CONFIG_DIR` | 指定全局配置目录（默认 `~/.xcode`）。 |

运行 `bun run src/entrypoints/cli.tsx auth status` 查看登录状态。将 `status` 改为 `logout` 可清除保存的 ChatGPT 登录凭据；如果设置了 `OPENAI_API_KEY`，需要单独取消该环境变量。xCode 不会导入 `~/.claude` 中的全局设置，但仍支持项目目录下的 `.claude/` 配置。

### 构建和测试

```sh
bun run build
bun test script/openai.integration.test.ts
```

集成测试使用本地模拟的 Responses API，不需要 OpenAI 凭据。

独立构建版本会在启动时及之后每 30 分钟通过 [GitHub Releases](https://github.com/xyzmean/xcode/releases) 检查更新，并在安装前验证 OTA 清单的签名。运行 `xcode update` 可手动检查，设置 `DISABLE_AUTOUPDATER=1` 可关闭后台检查。安装更新后请重启 xCode。

推送与 `package.json` 版本匹配的 `v<版本号>` 标签后，GitHub Actions 会发布全部六种二进制文件。推送标签前，请将与更新程序公钥配对的 Ed25519 私钥保存到 Actions 密钥 `XCODE_OTA_SIGNING_KEY`。手动运行工作流只构建，不发布。
