# OCR convert Markdown — Obsidian 插件

将 PDF、Word、Excel、图片通过多模型 OCR 转换为 Markdown 笔记。模型可自定义。

## 快速开始

1. 安装并启用插件
2. 打开「设置 → OCR convert Markdown」
3. 填入 API Key，启用模型
4. 点击左侧 Ribbon 图标或 `Ctrl+P` → **Import external file**

## 使用方式

| 方式 | 操作 |
|------|------|
| Ribbon 图标 | 点击 📂 → 从电脑选择文件 |
| 右键 vault 文件 | 文件管理器右键 →「转换为 Markdown」 |
| 命令面板 | `Ctrl+P` →「Convert to Markdown」或「Import external file」 |

## 功能

- **PDF 转换** — 文字型直接提取；扫描件自动 OCR（逐页流式处理）
- **Word 转换** — 保留标题、加粗、列表层级
- **Excel 转换** — 多工作表原样转 Markdown 表格；日期自动格式化
- **图片 OCR** — PNG / JPG / WEBP → OCR 识别
- **自定义模型** — 可自由添加任意支持 OCR 的 API（OpenAI 兼容 / Gemini）
- **自动切换** — 按配置顺序依次尝试，失败后自动换下一个模型

## 模型配置

支持添加任意数量的 OCR 模型，每个模型包含：

| 配置项 | 说明 |
|--------|------|
| 名称 | 显示名称 |
| API 协议 | `OpenAI 兼容` 或 `Gemini` |
| API 地址 | 接口 URL |
| API Key | 认证密钥 |
| 模型名 | 发送给 API 的模型标识 |
| Max Tokens | 每次请求最大输出 Token 数 |
| 启用 | 是否加入 OCR 调用链 |

使用 ↑↓ 箭头调整顺序，模型按从上到下的顺序依次调用。

**预置模型：**

| 模型 | 协议 |
|------|------|
| GLM-4V（高精度） | OpenAI |
| GLM-4V-Flash（快速） | OpenAI |
| MiniMax-VL | OpenAI |
| Gemini 2.5 Flash | Gemini |

## 安装

下载 `main.js`、`manifest.json`、`styles.css` 放入 `vault/.obsidian/plugins/ocr-convert-markdown/` 目录。

```bash
git clone git@github.com:solituder-12day/ocr-convert-markdown.git
cd ocr-convert-markdown
npm install
npm run build
```

## 技术栈

**TypeScript + esbuild** / **pdfjs-dist** / **mammoth.js** / **SheetJS**

## 作者

solituder-12day

## 许可

MIT
