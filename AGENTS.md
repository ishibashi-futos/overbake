## Overview

Bun 製 TypeScript による型補完で快適に書けるタスクランナー。

## 作業ルール

- 日本語で応答する
- ドキュメント作成は日本語で行う
- コメントは日本語でつける
- コードは常にメンテナンス製とテスト容易性を最も重要視する
- 時間の節約・開発スループットよりも、確実とトレーサビリティを優先する
- 後方互換性や例外処理のために処理を複雑にせず、シンプルで唯一の正解のために `DRY` な実装を行う
- 開発の実作業・レビューなどは、Claude Codeを別プロセスで最大４多重まで呼び出すことを許可する。

## Claude Codeの呼び出し方法

実行例:

claude -p "<依頼内容>" \
  --permission-mode bypassPermissions \
  --output-format text

制約:
- 編集は Codex 側では行わない。Codexは、Claudeのマネージャーとして、動作を管理する
- Claude の出力はそのまま採用せず、Codex が検証してから反映する

## Folder Rule

- `@src/ `- Bunのコード本体
- `@test/` - テストコードを格納する

## Definition of Done

- `scripts/sanity.sh` を実行し、型エラー・フォーマット・全件テストが全てパスすること
