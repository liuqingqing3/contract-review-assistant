#!/bin/zsh
cd -- "${0:A:h}"
task_node="$(command -v node)"
if [[ -z "$task_node" && -x "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node" ]]; then
  task_node="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
fi
if [[ -z "$task_node" ]]; then
  print '未找到 Node.js。请从 https://nodejs.org 安装 Node.js 22 或更高版本，再重新打开。不要把密钥发到聊天中。'
  read -r '?按回车退出'
  exit 1
fi
"$task_node" backend/local.mjs
read -r '?按回车关闭窗口'
