import assert from "node:assert/strict";
import { stripOcrPreamble } from "../src/ocr/outputCleanup";

assert.equal(
  stripOcrPreamble("以下是您提供的图片中的真实文字、数字、命令、账号、路径、IP、端口、版本号，原样输出核心内容：\nadmin>sysoption"),
  "admin>sysoption",
  "Chinese OCR preambles should be stripped"
);

assert.equal(
  stripOcrPreamble("The image contains the following text:\nhello"),
  "hello",
  "English OCR preambles should be stripped"
);

assert.equal(
  stripOcrPreamble('示例：\n```\n#!/bin/bash\necho "Hello, world!"\n```\n输出结果：\n```\n#!/bin/bash\necho "Hello, world!"\n```\nPassword: ******'),
  "Password: ******",
  "hallucinated example/result blocks should be stripped"
);

assert.equal(
  stripOcrPreamble("以下是您提供的图片中的真实文字、数字、命令、账号、路径、IP、端口、版本号的核心内容：\n旁挂//:"),
  "旁挂//:",
  "long Chinese OCR explanation preambles should be stripped"
);

assert.equal(
  stripOcrPreamble("示例：\n```\n后台服务器：\nbs后台： drcom/hebUT@_o\n```\n以下是被提取的内容（包括正文和部分注释）：\nadmin>sysoption"),
  "admin>sysoption",
  "standalone hallucinated example blocks before OCR preambles should be stripped"
);

console.log("output cleanup tests passed");
