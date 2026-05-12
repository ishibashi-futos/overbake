#!/bin/zsh

# pipefailを有効にし、パイプライン内のエラーを検知可能にする
set -o pipefail

echo "Running sanity checks..."

# 失敗があっても残りの工程を最後まで走らせ、失敗した工程の出力をその場で表示する。
# （fail-fast にしないことで、tsc・biome・テストのエラーを 1 回の実行でまとめて確認できる）
failures=0

run_check() {
  local label=$1
  shift

  echo -n "  - $label... "

  # 実行中に出力を出さないよう、変数にキャプチャ
  # local と代入を分けることで、コマンド自体の終了ステータスを正しく $? に反映させる
  local output
  output=$("$@" 2>&1)
  local exit_code=$?

  if [ $exit_code -eq 0 ]; then
    echo "✅ OK"
  else
    echo "❌ FAILED"
    echo "--------------------------------------------------"
    # 失敗した工程の出力（エラー内容）をそのまま表示する
    echo "${output}"
    echo "--------------------------------------------------"
    failures=$((failures + 1))
  fi
}

# 各工程を実行（途中で止めず、全部走らせる）
run_check "Type check" bunx tsc --noEmit
run_check "Formatting" bunx biome check .
run_check "Build" bun run build
run_check "Unit tests" bun test

if [ "$failures" -gt 0 ]; then
  echo "\n💥 $failures check(s) failed."
  exit 1
fi

echo "\n✨ All checks passed! You're good to go."
