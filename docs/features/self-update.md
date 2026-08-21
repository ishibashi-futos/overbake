# `bake update` — 自己更新

`bake update` は GitHub Releases の最新リリースを取得し、現在のプラットフォーム向けアセットを
ダウンロードして、実行中の `bake` バイナリ（`process.execPath`）自身を置き換えます。

## 使い方

```bash
bake update          # 最新版を確認し、新しければダウンロードして置き換える
bake update --check  # 確認のみ。ダウンロード・置き換えは行わない
bake update --force  # 同一/新しいバージョンでも再インストールする
```

## 対応プラットフォーム

現在の `process.platform` / `process.arch` の組み合わせから、ダウンロードするアセット名を決定します。

| platform/arch | アセット名 |
|---|---|
| linux/x64 | `bake-linux-x64` |
| darwin/arm64 | `bake-darwin-arm64` |
| win32/x64 | `bake-windows-x64.exe` |

上記以外の組み合わせは非対応で、`exitCode = 2` で終了します。

## 置き換え方式

一時ファイルは置き換え先と同一ディレクトリに作成します（`rename` はファイルシステムをまたぐと
原子的でなくなる/`EXDEV` になるため）。

- **Unix**: `rename` は原子的なため、一時ファイルを直接ターゲットへ `rename` するだけで置き換えられます。
  実行中のバイナリであっても安全に置換でき、旧 inode は開いたまま残ります。
- **Windows**: 実行中の `.exe` へは上書き `rename` ができません。そのため次の順で置換します。
  1. 旧ファイルを `<binary>.old-<pid>` へ `rename`（退避）
  2. 新ファイルをターゲットの位置へ配置
  3. 新ファイルの配置に失敗した場合は、退避した旧ファイルを元の位置へ `rename` し直してロールバックする

  退避ファイルは実行中ロックにより削除できないことがあります。その場合は次回 `bake update` 実行時に
  同一ディレクトリの `<binary>.old-*` を掃除します。

## バージョン比較

リリースタグは `vX.Y.Z` 形式である前提の最小比較です。完全な SemVer 2.0 の prerelease 順序は実装せず、
数値トリプル（`X.Y.Z`）が同値の場合のみ prerelease の有無で比較します。prerelease 付きのバージョン
（例: dev ビルドの `0.1.0-dev`）は、同じ数値トリプルのリリース版より古いものとして扱います。

## 終了コード / エラー時の挙動

- ネットワーク失敗・リリース未公開・アセット欠落: `exitCode = 1`
- 非対応プラットフォーム: `exitCode = 2`
- バイナリの置換に書き込み権限がない場合: 権限不足であることを伝えるエラーメッセージを表示し、
  `exitCode = 1` で終了します

## リリース側の仕組み

`v*` タグを push すると `.github/workflows/build.yml` が起動し、linux/x64・darwin/arm64・win32/x64 の
3 プラットフォーム分のバイナリをビルドして GitHub Release に添付します。ここで使うアセット名は
`src/update/platform.ts` の `ASSET_LINUX_X64` / `ASSET_DARWIN_ARM64` / `ASSET_WINDOWS_X64` と
一致させる必要があります。
