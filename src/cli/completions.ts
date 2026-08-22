export function generateZshCompletion(): string {
  return `#compdef bake

_bake() {
  local -a subcommands tasks

  subcommands=(
    'init:Bakefile.ts を初期化する'
    'list:タスク一覧を表示する'
    'completions:シェル補完スクリプトを出力する'
    'doctor:Bakefile.ts を検証する'
    'glaze:Bakefile.ts を整形する'
    'update:bake を最新リリースへ更新する'
    'ps:起動中のデーモン一覧を表示する'
    'stop:デーモンを停止する'
    'logs:デーモンのログを表示する'
  )

  tasks=("\${(@f)$(bake __complete tasks 2>/dev/null)}")

  _arguments -C \\
    '--help[ヘルプを表示]' \\
    '--dry-run[実行計画を表示（タスクは実行しない）]' \\
    '--explain[タスク詳細と依存を表示]' \\
    '--watch[ファイル変更を監視して自動再実行]' \\
    '--keep-going[失敗しても続行]' \\
    '--quiet[タスク出力を抑制]' \\
    '--no-summary[サマリー出力を抑制]' \\
    '--verbose[詳細ログを表示]' \\
    '--no-color[カラー出力を無効化]' \\
    '--graph[依存グラフを出力（既定は mermaid 形式）]' \\
    '--graph=mermaid[依存グラフを mermaid 形式で出力]' \\
    '--graph=dot[依存グラフを dot 形式で出力]' \\
    '--check[glaze/update: 書き換えずに確認のみ]' \\
    '--force[update: 最新でも再インストール]' \\
    '--yes[確認プロンプトをスキップ]' \\
    '-y[確認プロンプトをスキップ]' \\
    '-l[タスク一覧を表示]' \\
    '--daemon[タスクをバックグラウンドのデーモンとして起動]' \\
    '-d[タスクをバックグラウンドのデーモンとして起動]' \\
    '--all[stop: 全デーモンを停止]' \\
    '--follow[logs: ログを追従表示]' \\
    '-f[logs: ログを追従表示]' \\
    '-n[logs: 表示行数]' \\
    '1: :->first' \\
    '*: :->rest'

  case "$state" in
    first|rest)
      _describe 'subcommand' subcommands
      [[ \${#tasks[@]} -gt 0 ]] && _describe 'task' tasks
      ;;
  esac
}

_bake "$@"
`;
}

export function generateBashCompletion(): string {
  return `_bake() {
  local cur prev
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"

  local subcommands="init list completions doctor glaze update ps stop logs"
  local flags="--help --dry-run --explain --watch --keep-going --quiet --no-summary --verbose --no-color --check --force --yes -y -l --daemon -d --all --follow -f -n --graph --graph=mermaid --graph=dot"

  if [[ "$prev" == "completions" ]]; then
    COMPREPLY=($(compgen -W "zsh bash fish" -- "$cur"))
    return 0
  fi

  local tasks
  tasks=$(bake __complete tasks 2>/dev/null)

  COMPREPLY=($(compgen -W "$subcommands $flags $tasks" -- "$cur"))
}

complete -F _bake bake
`;
}

export function generateFishCompletion(): string {
  return `# bake の fish 補完スクリプト

complete -c bake -e

complete -c bake -f -n 'not __fish_seen_subcommand_from init list completions doctor glaze update ps stop logs' -a 'init' -d 'Bakefile.ts を初期化する'
complete -c bake -f -n 'not __fish_seen_subcommand_from init list completions doctor glaze update ps stop logs' -a 'list' -d 'タスク一覧を表示する'
complete -c bake -f -n 'not __fish_seen_subcommand_from init list completions doctor glaze update ps stop logs' -a 'completions' -d 'シェル補完スクリプトを出力する'
complete -c bake -f -n 'not __fish_seen_subcommand_from init list completions doctor glaze update ps stop logs' -a 'doctor' -d 'Bakefile.ts を検証する'
complete -c bake -f -n 'not __fish_seen_subcommand_from init list completions doctor glaze update ps stop logs' -a 'glaze' -d 'Bakefile.ts を整形する'
complete -c bake -f -n 'not __fish_seen_subcommand_from init list completions doctor glaze update ps stop logs' -a 'update' -d 'bake を最新リリースへ更新する'
complete -c bake -f -n 'not __fish_seen_subcommand_from init list completions doctor glaze update ps stop logs' -a 'ps' -d '起動中のデーモン一覧を表示する'
complete -c bake -f -n 'not __fish_seen_subcommand_from init list completions doctor glaze update ps stop logs' -a 'stop' -d 'デーモンを停止する'
complete -c bake -f -n 'not __fish_seen_subcommand_from init list completions doctor glaze update ps stop logs' -a 'logs' -d 'デーモンのログを表示する'
complete -c bake -f -n '__fish_seen_subcommand_from completions' -a 'zsh bash fish'

complete -c bake -l help -d 'ヘルプを表示'
complete -c bake -l dry-run -d '実行計画を表示（タスクは実行しない）'
complete -c bake -l explain -d 'タスク詳細と依存を表示'
complete -c bake -l watch -d 'ファイル変更を監視して自動再実行'
complete -c bake -l keep-going -d '失敗しても続行'
complete -c bake -l quiet -d 'タスク出力を抑制'
complete -c bake -l no-summary -d 'サマリー出力を抑制'
complete -c bake -l verbose -d '詳細ログを表示'
complete -c bake -l no-color -d 'カラー出力を無効化'
complete -c bake -l graph -d '依存グラフを出力（既定は mermaid 形式）'
complete -c bake -f -a '--graph=mermaid' -d '依存グラフを mermaid 形式で出力'
complete -c bake -f -a '--graph=dot' -d '依存グラフを dot 形式で出力'
complete -c bake -l check -d 'glaze/update: 書き換えずに確認のみ'
complete -c bake -l force -d 'update: 最新でも再インストール'
complete -c bake -l yes -d '確認プロンプトをスキップ'
complete -c bake -s y -d '確認プロンプトをスキップ'
complete -c bake -s l -d 'タスク一覧を表示'
complete -c bake -l daemon -d 'タスクをバックグラウンドのデーモンとして起動'
complete -c bake -s d -d 'タスクをバックグラウンドのデーモンとして起動'
complete -c bake -l all -d 'stop: 全デーモンを停止'
complete -c bake -l follow -d 'logs: ログを追従表示'
complete -c bake -s f -d 'logs: ログを追従表示'
complete -c bake -s n -d 'logs: 表示行数'

complete -c bake -f -n 'not __fish_seen_subcommand_from init list completions doctor glaze update ps stop logs' -a '(bake __complete tasks 2>/dev/null)'
complete -c bake -f -n '__fish_seen_subcommand_from stop' -a '(bake __complete tasks 2>/dev/null)' -d 'タスク名'
complete -c bake -f -n '__fish_seen_subcommand_from logs' -a '(bake __complete tasks 2>/dev/null)' -d 'タスク名'
`;
}
