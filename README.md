# 新卒採用ペルソナ設計スタジオ

採用サイトやマイナビの掲載内容を企業情報として入れると、

1. **狙う学生像（ペルソナ）を複数生成し**
2. **候補者ごとのマッチ度を 0〜100 で数値化して**
3. **そのペルソナに合わせたスカウトメールを作る**

までを一本の画面で回せるツールです。各ステップの入出力は JSON 契約として固定されているので、
既存の採用管理システムやスプレッドシートにそのまま渡せます。

## ダウンロード

**最新版 v0.1.0**: https://github.com/d39i78j19-png/-/releases/tag/v0.1.0

インストーラをダウンロードして起動するだけで使えます。Node.js やターミナルの知識は不要です。

| OS | ダウンロード | 起動方法 |
| --- | --- | --- |
| **Windows** | [persona-studio-0.1.0-windows-setup.exe](https://github.com/d39i78j19-png/-/releases/download/v0.1.0/persona-studio-0.1.0-windows-setup.exe) (143MB) | 実行してインストール → スタートメニューから起動 |
| **macOS**（M1/M2/M3 以降） | [persona-studio-0.1.0-mac-arm64.dmg](https://github.com/d39i78j19-png/-/releases/download/v0.1.0/persona-studio-0.1.0-mac-arm64.dmg) (186MB) | 開いて Applications にドラッグ → 初回のみ**右クリック→開く** |
| **macOS**（Intel） | [persona-studio-0.1.0-mac-x64.dmg](https://github.com/d39i78j19-png/-/releases/download/v0.1.0/persona-studio-0.1.0-mac-x64.dmg) (188MB) | 同上 |
| **Linux** | [persona-studio-0.1.0-linux-x86_64.AppImage](https://github.com/d39i78j19-png/-/releases/download/v0.1.0/persona-studio-0.1.0-linux-x86_64.AppImage) (245MB) | `chmod +x` してダブルクリック |

> Mac をお使いの方へ: メニューの  → 「このMacについて」でチップ名を確認してください。
> 「Apple M〜」と書かれていれば arm64、「Intel」と書かれていれば x64 です。

配布物は GitHub Actions が3 OS 分をビルドします（`.github/workflows/build-desktop-app.yml`）。
次のバージョンを出すときは、Actions からこのワークフローを手動実行して
`release_tag` に `v0.2.0` のように入力すると、ビルドから Release 作成まで自動で行われます。
`v*` のタグを push しても同じことが起こります。

> **署名について**: コード署名を行っていないため、macOS は初回に「開発元を確認できません」と出ます。
> 右クリック→開く で一度許可すれば以降は通常起動できます。Windows も SmartScreen の
> 警告が出る場合は「詳細情報」→「実行」を選んでください。社内配布で警告を消したい場合は
> 署名証明書が必要です。

### APIキーの登録

アプリ上部の「Claude API キー」→**設定**から登録します。未登録でも全機能が
同梱のルールベースエンジンで動作するので、まず触ってから決められます。

キーはお使いの PC のユーザーデータ領域に、本人のみ読み書きできる権限（0600）で保存されます。
暗号化はされないため、共用 PC では環境変数での運用を推奨します。アプリ内のボタンでいつでも削除できます。

### 設計データの保存

作業内容は自動保存され、次回起動時に復元されます。
**「JSONで書き出す」**で企業情報・ペルソナ定義・採点済み候補者・スカウトメールを1ファイルに
まとめてダウンロードできます。**「JSONを読み込む」**で復元・共有できます。

## ペルソナの顔写真

プロトタイプ画面（`standalone/public/index.html`）にペルソナの顔写真を出すための
サーバーが `standalone/` にあります。依存パッケージなしで動きます。

```bash
npm run portraits:serve       # http://localhost:8787 を開く
```

顔写真の出し方は2通りあり、**APIキーなしで使える A を推奨**しています。

**A. 写真を先に入れておく（APIキー不要・課金なし・即時）**
`http://localhost:8787/photos.html` から顔写真を取り込みます。顔写真が格子状に
並んだ1枚の画像（コンタクトシート）を、行数・列数を指定して1人ずつ切り出すこともできます。
取り込んだ写真は、ペルソナの性別・年齢・表情に合わせて自動で割り当てられます。
採用する顔を人の目で選び切れるので、品質が最も安定します。

**B. 都度APIで生成する**

```bash
export GEMINI_API_KEY="..."   # または OPENAI_API_KEY
npm run portraits:serve
```

課金前にプロンプトを確認するには `npm run portraits:dry-run`。
割り当ての仕組み・プロンプト設計・費用・失敗時の直し方は
[`standalone/README.md`](standalone/README.md) を参照してください。

## 開発する人向け

```bash
npm install
npm run dev      # ブラウザ版 http://localhost:3000
npm run app:dev  # デスクトップアプリとして起動
```

配布物のビルド:

```bash
npm run app:linux   # AppImage
npm run app:win     # Windows インストーラ（Windows 上で実行）
npm run app:mac     # dmg（macOS 上で実行）
```

`.exe` と `.dmg` はそれぞれ Windows / macOS 上でしかビルドできません。1台で3 OS 分作りたい場合は
GitHub Actions を使ってください。

ブラウザ運用する場合、APIキーは環境変数で渡します（この場合アプリ画面からは変更できません）。

```bash
cp .env.example .env.local   # ANTHROPIC_API_KEY を記入
```

## 3つのエンジン

| エンドポイント | 役割 | 生成方式 |
| --- | --- | --- |
| `POST /api/personas` | company_info → ペルソナ N 件 | Claude（キー無しならルールベース） |
| `POST /api/match` | persona × candidate → スコア内訳 | **決定論的なルール計算**（extras のみ Claude 併用可） |
| `POST /api/emails` | persona × candidate × position → メール3通 | Claude（キー無しならテンプレート） |

すべて `?strict=1` を付けると JSON 契約のキーだけを返します。付けない場合は UI 用に
`_meta`（どのエンジンが動いたか・自動補正の記録）と `_trace`（採点根拠）が付きます。

### なぜマッチングだけ LLM に投げないのか

指定された採点ルール（Jaccard 係数、キーワード一致数、都道府県の比較、加重平均）は
すべて計算式として閉じています。これを LLM に計算させると、**同じ候補者に毎回違う点が付き**、
「なぜこの学生が落ちたのか」を説明できなくなります。選考の判断材料として使う数値なので、
TypeScript で実装して決定論的にしました。

例外は `extras_score` です。仕様が「活動の質・頻度を簡易に文脈から判断」を求めており、
これはルールでは書けません。API キーがある場合のみ、この1軸だけ Claude の判定で上書きし、
`_meta.note` にその旨を記録します。

## マッチスコアの計算

`final_score = round(Σ weights[軸] × 軸スコア)`（0〜100 の整数）

| 軸 | 算出方法 |
| --- | --- |
| `skills` | 候補者スキル ∩ ペルソナ想定スキル の Jaccard 係数 × 100。想定スキルが空なら 0 |
| `culture` | 「company values + ペルソナ description のキーワード + priority_roles」の一致数 ÷ キーワード総数 |
| `major` | 完全一致 100 / 関連分野 70 / 非関連 20 / 不明 50 |
| `location` | 同市区町村 100 / リモート可×候補者リモートOK 80 / 同都道府県 70 / その他 20 |
| `extras` | 想定活動との合致度 70% + 活動の質シグナル 30%（または Claude の文脈判断） |

`weights` の合計が 1.0 でない場合は必ず正規化されます（合計 10 で渡しても 0.5/0.2/0.1/0.1/0.1 になります）。

### 設計上のトレードオフ（運用前に知っておくべきこと）

- **`skills` は Jaccard なので「書いていないスキル」で減点されます。** 候補者が
  「JavaScript, React, Python」と書き、ペルソナ想定が「プログラミング基礎, Git, JavaScript,
  論理的思考, React」だと、実際は満たしているであろう Git や論理的思考が和集合に入るため
  Jaccard は 0.33 に留まります。仕様どおりの実装ですが、母集団を絞り込みすぎる傾向が出たら、
  分母を候補者スキル数だけにする Overlap 係数への変更を検討してください
  （`src/lib/matchEngine.ts` の `scoreSkills` 1関数の変更で済みます）。
- **`culture` は投入する自由記述の量に強く依存します。** 一致数を分母（キーワード総数）で
  割るため、ES が数行しかない候補者は構造的に低得点になります。`description` から拾う語は
  5 件で打ち切って分母を安定させていますが、カルチャー軸を重く使うなら
  `resume_text` にまとまった量の文章を入れてください。
- **`major`／`location` は表記ゆれを辞書と正規表現で吸収しています。** 想定外の表記が来たときは
  UI の内訳に判定理由（「非関連分野として 20」など）が出るので、そこで気づけます。

## スキーマ検証について

Claude の Structured Outputs は「キーと型」を保証しますが、
`minLength` / `minimum` をサポートしないため以下は保証されません。
これらは `src/lib/validate.ts` でコード側が機械的に担保しています。

- `description` が 150〜200 文字 → 短ければ company_info 由来の文で補い、長ければ句点で切る
- `weights` の合計が 1.0 → 常に正規化
- `id` が `persona-N` の連番 → 振り直す

自動補正が入った場合は `_meta.warnings` に理由が残り、画面にも表示されます。

## 構成

```
electron/
  main.js          Next サーバーを子プロセスで起動しウィンドウに表示する
scripts/
  prepare-standalone.mjs  standalone 出力に静的アセットを流し込む
src/lib/
  schema.ts        型定義（JSON 契約と 1:1）
  project.ts       設計データ一式（JSON）の形式と検証
  keyStore.ts      APIキーの保存先と読み出し
  jsonSchemas.ts   Structured Outputs 用の JSON Schema
  prompts.ts       3エンジンのシステムプロンプト
  anthropic.ts     Claude 呼び出し（refusal 処理・フォールバック込み）
  matchEngine.ts   決定論的な採点エンジン
  personaEngine.ts ルールベースのペルソナ生成
  emailEngine.ts   ルールベースのメール生成
  text.ts          正規化・都道府県・専攻分野・キーワード辞書
  weights.ts       重みの正規化
  validate.ts      リクエスト検証と出力の自動補正
src/app/api/       personas / match / emails
src/components/    UI パーツ
```

## 運用上の注意

- スコアは設計した重みに基づく**参考値**です。合否判断は必ず人が行ってください。
- 学歴・性別・年齢などの属性そのものを評価軸にしない設計にしています。
  ペルソナの `university_level` も「国立大学（情報系学部）」程度の幅を持った表記に留め、
  特定校を要件として名指ししません。
- 生成されたスカウトメールは、内定・年収・選考通過を約束する表現を含めない指示を入れていますが、
  送信前に必ず内容を確認してください。
