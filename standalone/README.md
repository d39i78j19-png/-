# ペルソナ顔写真生成サーバー

`public/index.html`（チェック選択型ペルソナ ＆ 顔写真・分析生成アプリ）の
バックエンドです。

## なぜ顔写真が出なかったのか

画面は最初から `http://localhost:8787` のサーバーを呼ぶ前提で書かれていました。

```
ブラウザ → localhost:8787 → Gemini 画像生成API → 画像 → ブラウザ
```

ところが **そのサーバーの実体がリポジトリに存在しませんでした**。
`/api/persona/image` への `fetch` は毎回ネットワークエラーになり、画面は
`faceHTML()` のフォールバックに落ちて SVG イラストを表示し続けます。
「顔写真が生成されない」の原因はこれです。

画面内には Gemini を直接叩く関数もありましたが、`generatePortraits_unused` という
名前のとおり呼び出し元が無く、参照している `#photoBtn` も存在せず、
`settings.geminiKey` を入力する UI もないため、こちらも動きませんでした。

このディレクトリが、その欠けていたサーバーです。

## 起動

```bash
export GEMINI_API_KEY="..."     # https://aistudio.google.com/apikey
node standalone/server.js       # = npm run portraits:serve
```

`http://localhost:8787` を開くと画面が出ます。APIキーはサーバーの環境変数からのみ
読み込まれ、ブラウザには一切渡りません。

STEP 1 でペルソナを作ってから、STEP 2 の

- **この人の顔写真を生成** — 表示中の1人だけ
- **全員の顔写真を生成** — 一覧の全員（1枚10〜20秒 × 人数）
- **AIでペルソナ＋画像を生成** — 本文と顔写真をまとめて
- **画像プロンプトを確認** — 課金前にプロンプトを読む

を押します。

## APIキーが無いとき

キーが無くても画面は壊れません。次の順に落ちます。

| 順 | 条件 | 返るもの |
|---|---|---|
| 1 | 同じプロンプトで生成済み | ディスクキャッシュの画像（無料・即時） |
| 2 | `GEMINI_API_KEY` あり | Gemini で新規生成し、キャッシュに保存 |
| 3 | `personas/pool/` に事前生成画像あり | プールから性別が合うものを割り当て |
| 4 | いずれも無い | イニシャル入りのプレースホルダSVG |

`<img>` の壊れアイコンが出ることはありません。

キャッシュのキーは「モデル｜サイズ｜プロンプト」のハッシュです。同じペルソナを
何度表示しても課金は初回の1回だけで、デモを回しても費用は増えません。

## 事前に写真を焼いておく（プール）

APIキーが無い環境でも顔写真つきで見せたい場合、先に焼いてコミットしておきます。

```bash
# 1. 課金前に必ずプロンプトと概算費用を確認する（APIを叩かない）
node standalone/bin/generate-pool.mjs --dry-run

# 2. まず1枚だけ試して作風を見る
GEMINI_API_KEY=... node standalone/bin/generate-pool.mjs --only male-01

# 3. 問題なければまとめて
GEMINI_API_KEY=... node standalone/bin/generate-pool.mjs --count 12
```

出力先は `public/personas/pool/`。ファイル名は `male-01.jpg` `female-03.jpg` の形式で、
サーバーは性別が合うものを順に割り当てます。

主なオプション:

| オプション | 説明 |
|---|---|
| `--count N` | 生成枚数（既定12・男女半々） |
| `--only <id>` | 1件だけ生成。失敗した分の作り直しに使う |
| `--personas <file>` | 自前のペルソナ定義JSONから生成 |
| `--wardrobe casual` | リクルートスーツではなく私服にする |
| `--scene office` | 大学ではなくオフィス背景にする |
| `--model` `--size` | 既定は `gemini-3-pro-image` / `2K` |
| `--anchor <file>` | 同一人物の別カットを作るときの参照画像 |
| `--force` | 既存ファイルがあっても作り直す |

## リアルさを上げるために入れていること

プロンプトは `lib/portrait-prompt.js` で組み立てます。**固定ブロック**（全員で
一字一句同じ）と**可変ブロック**（人物ごと）に分けているのが要点です。

固定側を揃えることで、一覧に並べたときライティングと画角が統一され、
寄せ集め感が消えます。可変側を散らすことで「同じ人が複数いる」のを防ぎます。

| 効いている指定 | 理由 |
|---|---|
| `Natural skin texture with visible pores` `unretouched` `no beauty filter` | 入れないと全員が美容修正済みのモデル顔になり、ペルソナとして機能しない |
| `slight natural facial asymmetry` | 左右対称の顔はCG的に見える |
| 年齢を皮膚と姿勢で書く（`smooth complexion, a soft jawline`） | 「22歳」と数字だけ書いても反映されにくい |
| `East Asian features` `natural Japanese complexion` を主語の直後に | `Japanese` だけだと西洋顔に日本人名が付いた画像が返ることがある |
| 表情を性格・課題から出し分け | 笑顔一択にするとストックフォトになる |
| 視線を散らす（正面／斜め／視線外し） | 全員カメラ目線だと証明写真の並びになる |
| 背景を候補ごとに変える | 全員同じ背景だと誰が誰か分からなくなる |
| `1:1` で生成 | 丸型アバターに切る前提。他比率から丸く切ると頭頂と顎が欠ける |
| `beautiful` `handsome` を**書かない** | モデル顔に寄り、個体差が消える |

生成した画像は必ず目視で確認してください。API が返した＝使える、ではありません。

| よくあるズレ | 直し方 |
|---|---|
| 指定より若く／老けて出る | `lib/portrait-prompt.js` の `AGE_LOOK` に皮膚・姿勢の記述を足す |
| 全員似た顔になる | `HAIR` `WARDROBE` `SETTINGS` の差を大きくする |
| 文字やロゴが写り込む | 背景の指定を単純にする |
| 手が崩れている | `PROPS` を `none` に寄せる |
| 日本人に見えない | `East Asian features` を主語のさらに直前に移す |

問題があった人だけ `--only <id>` で作り直します。全体を作り直す必要はありません。

## 環境変数

| 変数 | 既定 | 説明 |
|---|---|---|
| `GEMINI_API_KEY` | — | 画像生成に必須 |
| `ANTHROPIC_API_KEY` | — | ペルソナ本文とAI診断。未設定ならルールベース |
| `PORTRAIT_MODEL` | `gemini-3-pro-image` | 試行段階は `gemini-3.1-flash-image` が約半額 |
| `PORTRAIT_SIZE` | `2K` | `512` / `1K` / `2K` / `4K` |
| `PORTRAIT_WARDROBE` | `auto` | `auto`=リクルートスーツ / `casual`=私服 |
| `PORTRAIT_SCENE` | `student` | `student` / `office` |
| `PORT` | `8787` | |

## エンドポイント

| メソッド | パス | 用途 |
|---|---|---|
| GET | `/api/health` | キーの有無・使用モデル・プール枚数 |
| POST | `/api/persona/prompt` | プロンプトだけ返す（課金なし） |
| POST | `/api/persona/image` | 顔写真1枚 |
| POST | `/api/pipeline` | ペルソナ本文 + 顔写真をまとめて |
| POST | `/api/analyze/requirements` | 採用要件の診断 |
| POST | `/api/analyze/scout` | スカウト文の添削 |
| POST | `/api/analyze/company` | 採用ページの読み取り |

依存パッケージはありません。`node standalone/server.js` だけで起動します。

## 生成した顔の扱い

- 生成画像は**ペルソナ・デモ用**です。実在の内定者・社員・顧客であるかのように
  提示しないでください。
- 社外に出す場合は「※画像はイメージです。実在の人物ではありません」の注記を入れてください
  （画面のペルソナカードには既に入っています）。
- Gemini の生成画像には SynthID の不可視ウォーターマークが入ります
  （無効化不可・画質への影響なし・商用利用の制限にはなりません）。

## 費用

画像モデルに無料枠はありません（課金アカウントが必要です）。

| モデル | 1K | 2K | 4K |
|---|---|---|---|
| `gemini-3.1-flash-lite-image` | $0.0336 | — | — |
| `gemini-3.1-flash-image` | $0.067 | $0.101 | $0.151 |
| `gemini-3-pro-image` | $0.134 | $0.134 | $0.24 |

12人分を pro / 2K で焼いて約 $1.6。キャッシュが効くので、以降の表示は無料です。
モデルIDと料金は変動するため、
[公式ドキュメント](https://ai.google.dev/gemini-api/docs/models)で最新を確認してください。
