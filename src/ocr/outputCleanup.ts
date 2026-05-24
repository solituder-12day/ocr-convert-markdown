export function stripOcrPreamble(text: string): string {
  return text
    .replace(/示例：\s*```[\s\S]*?```\s*输出结果：\s*```[\s\S]*?```\s*/g, "")
    .replace(/示例：\s*```[\s\S]*?```\s*(?=以下是|下面是|这是|图片中|您提供|Here|The image)/g, "")
    .replace(/^(以下是|下面是|这是|图片中|您提供的图片中|您提供的图片的)[^\n]*(内容|文字|文本|核心内容|主要内容)[：:]\s*/gm, "")
    .replace(/^以下是被提取的内容[^\n]*[：:]\s*/gm, "")
    .replace(/^以下是提取的内容[：:]\s*/gm, "")
    .replace(/^Here(?: is| are)[^\n]*(?:text|content)[：:]\s*/gim, "")
    .replace(/^The image contains[^\n]*[：:]\s*/gim, "")
    .trim();
}
