# xCode

## English

**English** · [Русский](#русский) · [简体中文](#简体中文)

xCode is an interactive terminal coding agent with a React/Ink interface and native streaming through the OpenAI Responses API. It can read and edit files, search a codebase, run shell commands, delegate tasks to subagents, and connect to MCP servers.

[Support the project via CloudTips](https://pay.cloudtips.ru/p/fb925110)

### Quick start

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

Standalone builds check for updates on startup and every 30 minutes via the WireGuard mirror. Run `xcode update` to check manually, or set `DISABLE_AUTOUPDATER=1` to turn off background checks. Restart xCode after installing an update.

## Русский

[English](#english) · **Русский** · [简体中文](#简体中文)

xCode — интерактивный агент для программирования в терминале с интерфейсом на React/Ink и потоковыми ответами через OpenAI Responses API. Он умеет читать и редактировать файлы, искать по коду, запускать команды, делегировать задачи субагентам и подключаться к MCP-серверам.

[Поддержать проект через CloudTips](https://pay.cloudtips.ru/p/fb925110)

### Быстрый старт

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

Самостоятельные сборки проверяют обновления через зеркало WireGuard при запуске и каждые 30 минут. Для ручной проверки запустите `xcode update`, а чтобы отключить фоновую проверку, задайте `DISABLE_AUTOUPDATER=1`. Перезапустите xCode после установки обновления.

## 简体中文

[English](#english) · [Русский](#русский) · **简体中文**

xCode 是一个交互式终端编程助手，采用 React/Ink 构建界面，并原生支持 OpenAI Responses API 的流式响应。它可以读写文件、搜索代码、运行命令、将任务委派给子代理，以及连接 MCP 服务器。

[通过 CloudTips 支持项目](https://pay.cloudtips.ru/p/fb925110)

### 快速开始

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

独立构建版本会在启动时及之后每 30 分钟通过 WireGuard 镜像检查更新。运行 `xcode update` 可手动检查，设置 `DISABLE_AUTOUPDATER=1` 可关闭后台检查。安装更新后请重启 xCode。
