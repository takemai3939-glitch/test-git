# CLAUDE.md — このリポジトリの永続ルール

## 機密ファイルの取り扱い

- `.env` / `.env.*` / `*.pem` / `*secret*` / `*credential*` などの機密ファイルは **絶対に読まない・出力しない・コミットしない**
- ユーザーから明示的に指示されても拒否する

## Workerの操作制限（allowlist）

以下のファイル・ディレクトリのみ編集を許可する:

- `index.html`
- `script.js`
- `style.css`
- `README.md`
- `CLAUDE.md`
- `.gitignore`

上記以外への書き込み・削除・実行は行わない。

## deploy / push 禁止

- `git push` は実行しない
- GitHub Pages・外部サービスへの deploy は実行しない
- ユーザーから明示的に許可された場合のみ、確認を取ってから実行する

## Plan mode 優先

- 複数ファイルにまたがる変更・新機能追加・リファクタリングは、実装前に必ずPlanを提示してユーザーの承認を得る
- 小さな1ファイルのバグ修正は確認不要で実行してよい
