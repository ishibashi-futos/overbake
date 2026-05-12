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
  )

  tasks=("\${(@f)$(bake __complete tasks 2>/dev/null)}")

  _arguments -C \\
    '--help[ヘルプを表示]' \\
    '--dry-run[実行計画を表示（タスクは実行しない）]' \\
    '--explain[タスク詳細と依存を表示]' \\
    '--watch[ファイル変更を監視して自動再実行]' \\
    '--keep-going[失敗しても続行]' \\
    '--quiet[タスク出力を抑制]' \\
    '--verbose[詳細ログを表示]' \\
    '--no-color[カラー出力を無効化]' \\
    '--check[glaze: 書き換えずに整形チェックのみ]' \\
    '--yes[確認プロンプトをスキップ]' \\
    '-y[確認プロンプトをスキップ]' \\
    '-l[タスク一覧を表示]' \\
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

  local subcommands="init list completions doctor glaze"
  local flags="--help --dry-run --explain --watch --keep-going --quiet --verbose --no-color --check --yes -y -l"

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

complete -c bake -f -n 'not __fish_seen_subcommand_from init list completions doctor glaze' -a 'init' -d 'Bakefile.ts を初期化する'
complete -c bake -f -n 'not __fish_seen_subcommand_from init list completions doctor glaze' -a 'list' -d 'タスク一覧を表示する'
complete -c bake -f -n 'not __fish_seen_subcommand_from init list completions doctor glaze' -a 'completions' -d 'シェル補完スクリプトを出力する'
complete -c bake -f -n 'not __fish_seen_subcommand_from init list completions doctor glaze' -a 'doctor' -d 'Bakefile.ts を検証する'
complete -c bake -f -n 'not __fish_seen_subcommand_from init list completions doctor glaze' -a 'glaze' -d 'Bakefile.ts を整形する'
complete -c bake -f -n '__fish_seen_subcommand_from completions' -a 'zsh bash fish'

complete -c bake -l help -d 'ヘルプを表示'
complete -c bake -l dry-run -d '実行計画を表示（タスクは実行しない）'
complete -c bake -l explain -d 'タスク詳細と依存を表示'
complete -c bake -l watch -d 'ファイル変更を監視して自動再実行'
complete -c bake -l keep-going -d '失敗しても続行'
complete -c bake -l quiet -d 'タスク出力を抑制'
complete -c bake -l verbose -d '詳細ログを表示'
complete -c bake -l no-color -d 'カラー出力を無効化'
complete -c bake -l check -d 'glaze: 書き換えずに整形チェックのみ'
complete -c bake -l yes -d '確認プロンプトをスキップ'
complete -c bake -s y -d '確認プロンプトをスキップ'
complete -c bake -s l -d 'タスク一覧を表示'

complete -c bake -f -n 'not __fish_seen_subcommand_from init list completions' -a '(bake __complete tasks 2>/dev/null)'
`;
}
