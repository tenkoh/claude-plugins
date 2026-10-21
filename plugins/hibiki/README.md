# hibiki

Claude Code の直近の応答を、OpenAI 互換の `/audio/speech` エンドポイントで音声化してストリーミング再生する mod。
[speech.cpp](https://github.com/nyosegawa/speech.cpp) の `speech serve` を想定。macOS / Ubuntu 対応。

- プロンプト上の帯に「▶ 読み上げ / ■ 停止」ボタン
- `/hibiki`・`/hibiki-stop` コマンド
- コードブロックは丸ごと「ここにコードがきます」に置換（文言は設定可）
- リンク・表・見出し記号・強調記号なども読み上げ用に除去

## 必要なもの

- Claude Code v2.1.287 以降（mods 有効）
- `curl`、`bash`
- 再生コマンドのどれか: `ffplay`（ffmpeg）/ `play`（sox）/ `paplay` / `aplay`
  - macOS: `brew install ffmpeg` または `brew install sox`
  - Ubuntu: `sudo apt install ffmpeg`（`paplay`・`aplay` は大抵最初から入っている）

## 導入

```
/plugin marketplace add tenkoh/claude-plugins
/plugin install hibiki@tenkoh
```

インストール時の設定ダイアログで `player` などを指定する。あとから変えるときは `/plugin configure hibiki@tenkoh`。

TTS サーバーは別ターミナルで起動しておく。

```sh
speech serve qwen3-tts-0.6b
```

応答が終わるとプロンプトの上に ▶ が出る。`/hibiki`・`/hibiki-stop` でも操作できる。

## 設定

インストール時のダイアログ、`/plugin configure hibiki@tenkoh`、または `/config` で設定する。

| キー | 既定値 | 説明 |
|---|---|---|
| `endpoint` | `http://127.0.0.1:8080/v1` | ベースURL。`/audio/speech` を付けて叩く |
| `voice` | 空 | 話者。使うモデルに合わせて設定する。speech.cpp では必須で、モデルの話者名か `--add-voice` で追加した名前を指定する。`none` はモデルが声を選ぶ指定（Irodori-TTS / Drama 3）。Qwen3-TTS では話者名が必要 |
| `model` / `instructions` / `speed` | 空 | 空なら送らない（speech.cpp はモデルが受け付けないメンバーを 400 で拒否するため） |
| `player` | なし（必須） | `ffplay` / `play` / `paplay` / `aplay` から選ぶ。未設定・未インストールならエラー |
| `codePlaceholder` | `ここにコードがきます` | 空にするとコードブロックは無音で飛ばす |

## 送るリクエスト

OpenAI の create speech と同じメンバーだけを送る: `input`・`voice`・`response_format: "pcm"`、設定されていれば `model`・`instructions`・`speed`。モデルの選択・追加ボイス・デバイスなど speech.cpp 固有の設定は `speech serve` の起動オプションで渡す。

## 仕組み

- `turn.complete` でメイン会話の最終回答テキストを保持
- 再生時は `bin/speak.sh` を `$.process.spawn` で起動し、リクエスト JSON を stdin で渡す
- スクリプトは `curl -N` で `response_format: "pcm"` をストリーム受信し、ヘッダ受信後にレートを確定して再生コマンドへ流す
- 停止はスクリプトに TERM → curl と再生コマンドを両方止める（接続が切れるので speech.cpp 側も生成を止める）
- HTTP エラー時はエラー JSON をトーストで表示

OpenAI 本家など `pcm` を返せる他の互換サーバーでも動くが、サンプルレートは `X-Sample-Rate` ヘッダから取り、無ければ OpenAI の pcm と同じ 24000 とみなす。
