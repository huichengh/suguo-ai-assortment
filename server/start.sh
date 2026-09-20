#!/usr/bin/env bash
# ===================================================================
#  苏果智选 · 后台一键启动（macOS / Linux / Git Bash）
#  1) 缺虚拟环境则创建   2) 装依赖   3) 端口占用提示   4) 启动 uvicorn
# ===================================================================
set -e
cd "$(dirname "$0")"

PYEXE=".venv/bin/python"
[ -f "$PYEXE" ] || PYEXE=".venv/Scripts/python.exe"   # Git Bash on Windows

if [ ! -f "$PYEXE" ]; then
  echo "[1/4] 创建虚拟环境 .venv …"
  python3 -m venv .venv 2>/dev/null || python -m venv .venv
  PYEXE=".venv/bin/python"
  [ -f "$PYEXE" ] || PYEXE=".venv/Scripts/python.exe"
else
  echo "[1/4] 虚拟环境已存在。"
fi

echo "[2/4] 安装依赖 …"
"$PYEXE" -m pip install --quiet --upgrade pip
"$PYEXE" -m pip install --quiet -r requirements.txt

echo "[3/4] 检查 8000 端口 …"
if command -v lsof >/dev/null 2>&1 && lsof -i :8000 >/dev/null 2>&1; then
  echo "  警告：8000 端口疑似被占用，请关闭占用进程或改用其他端口。"
fi

echo "[4/4] 启动服务 …"
echo
echo "  接口地址 : http://127.0.0.1:8000/api/v1"
echo "  交互文档 : http://127.0.0.1:8000/docs"
echo "  演示账号 : admin / purchase / category / manager / viewer"
echo "  统一密码 : 123456"
echo
echo "  首次启动会自动灌入种子数据（约需数秒）。按 Ctrl+C 停止。"
echo
exec "$PYEXE" -m uvicorn app.main:app --host 127.0.0.1 --port 8000
