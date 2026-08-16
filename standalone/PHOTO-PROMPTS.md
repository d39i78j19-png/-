# 顔写真シートの生成プロンプト

顔写真プールに入れるシート画像を、画像生成AIで作るためのプロンプト集です。
そのままコピーして貼り付けて使えます。

## なぜ6枚に分けるのか

1枚のシートに60人を詰めると、1人あたり約100×100pxしか確保できません。
画面では222px（高精細画面では444px相当）で表示するため、4倍以上に拡大されて
ぼやけます。

かといって「幅6,000pxの1枚」は作れません。画像生成モデルの出力上限は
**Nano Banana（gemini-3-pro-image）で4K、gpt-image-1 で1536px** です。

そこで **1セグメント＝1枚**に分けます。5列なら1人あたりの幅は次のようになります。

| シート幅 | 1人あたり | 判定 |
|---|---|---|
| 1536px（現状・15列） | 約100px | ✗ ぼやける |
| 2048px（5列） | 約400px | ○ 実用 |
| 4096px（5列・4K） | 約800px | ◎ 余裕 |

アプリ側は1パネルのシートを自動で認識し、**まだ登録の無い分類**を初期値に選びます。
6枚を順に読み込むだけで6分類が埋まります。

---

## A. セグメント別シート（推奨）

`gemini-3-pro-image` で **アスペクト比 16:9 / image_size 4K** を指定してください。

各セグメントで、下の `【見出し】` と `【人物の方向性】` だけを差し替えます。

### 共通テンプレート

```
A photorealistic contact sheet of Japanese university students, arranged as a
single panel on a pure white background.

Layout, exactly:
- A solid coloured header bar across the full width at the very top, about 8% of
  the image height, containing the Japanese text: 【見出し】
- Below it, a row of 5 head-and-shoulders portraits of Japanese men in their
  early 20s, evenly spaced, separated by thin pure white gaps
- Below that row, a thin pure white strip about 15% of the row height containing
  the small black labels: ①男性 ②男性 ③男性 ④男性 ⑤男性
- Below that, a row of 5 head-and-shoulders portraits of Japanese women in their
  early 20s, same size and spacing as the men
- Below that row, a thin pure white strip with the small black labels:
  ①女性 ②女性 ③女性 ④女性 ⑤女性

Every portrait: a Japanese person, East Asian features, natural Japanese
complexion, in their early 20s, smooth complexion and a soft jawline, framed head
and shoulders, centred, looking at the camera. Soft diffused natural window light,
neutral colour grade, true-to-life skin tones. Shot on a full-frame mirrorless
camera with an 85mm lens at f/2.0, shallow depth of field, sharp focus on the eyes.
Natural skin texture with visible pores, slight natural facial asymmetry,
unretouched, no beauty filter, not glamorous, not fashion models. All ten people
must look like clearly different individuals — vary the hairstyles, face shapes
and builds.

【人物の方向性】

No watermark, no logos, no extra text beyond the header and the labels described
above, no borders around the whole sheet.
```

### 差し替える2箇所

| セグメント | 【見出し】 | 【人物の方向性】 |
|---|---|---|
| 成長志向ー大手 | `成長志向ー大手に行きたい顔` | `Wardrobe: dark navy or charcoal recruit suits with white shirts and plain ties for the men, black or navy recruit suit jackets over white blouses for the women. Expression: confident and outward-facing, an open genuine smile with bright engaged eyes. Background: a bright modern corporate lobby, softly blurred.` |
| 成長志向ーベンチャー | `成長志向ーベンチャーに行きたい顔` | `Wardrobe: smart casual — open-collar shirts, plain knit sweaters, a jacket over a white t-shirt; no ties. Expression: energetic and forward-leaning, a broad genuine smile. Background: a bright open-plan startup office with glass and plants, softly blurred.` |
| 成長志向ー中小 | `成長志向ー中小に行きたい顔` | `Wardrobe: relaxed casual — plain t-shirts, hoodies, cardigans, light jackets. Expression: friendly and approachable, a warm natural smile. Background: a bright office with large windows and greenery, softly blurred.` |
| 安定志向ー大手 | `安定志向ー大手に行きたい顔` | `Wardrobe: formal dark navy recruit suits with white shirts and plain navy ties for the men, black recruit suit jackets over white blouses for the women. Expression: calm and composed, a gentle closed-mouth smile with steady eyes. Background: a quiet neutral office wall, softly blurred.` |
| 安定志向ーベンチャー | `安定志向ーベンチャーに行きたい顔` | `Wardrobe: neat casual — plain shirts and simple knitwear in muted tones. Expression: mild and slightly reserved, a small polite smile. Background: a bright quiet office corner, softly blurred.` |
| 安定志向ー中小 | `安定志向ー中小に行きたい顔` | `Wardrobe: plain everyday clothes — simple shirts, cardigans, plain knit tops in soft neutral tones; one person may wear glasses. Expression: gentle and unhurried, a soft closed-mouth smile. Background: a plain bright interior, softly blurred.` |

### 取り込み手順

1. 6枚を生成する（1枚 = 1セグメント）
2. アプリの「顔写真プール」に**1枚ずつドラッグ＆ドロップ**
3. 「このシートの分類」が正しいか確認（**まだ空いている分類が自動で選ばれます**）
4. 「この内容で登録する」
5. これを6回

---

## B. 1人1枚で作る（最高画質）

1枚あたりの解像度を最大にしたい場合。`aspect_ratio 1:1` / `image_size 1K` 以上。

```
A photorealistic corporate headshot of a Japanese 【man / woman】 in 【his / her】
early 20s, East Asian features, natural Japanese complexion, smooth complexion and
a soft jawline. 【服装】. 【表情】. 【背景】.
Soft diffused natural window light from camera-left with gentle fill, no harsh
shadows, neutral colour grade, true-to-life skin tones. Shot at eye level on a
full-frame mirrorless camera with an 85mm portrait lens at f/2.0, shallow depth of
field, sharp focus on the eyes, head and shoulders framing, subject centred.
Natural skin texture with visible pores and fine flyaway hairs, slight natural
facial asymmetry, unretouched, no beauty filter, not glamorous, not a fashion
model. No text, no logos, no watermark.
```

【服装】【表情】【背景】は上の表の `Wardrobe:` `Expression:` `Background:` を
1人分の文に直して入れてください。

取り込みは「1枚ずつ取り込む」で、**セグメントと性別を選んでから**まとめて選択します
（この経路は1024pxまで解像度を保持します）。

---

## 注意

- 生成画像は**ペルソナ・デモ用**です。実在の内定者・社員・顧客であるかのように
  提示しないでください
- 社外に出す場合は「※画像はイメージです。実在の人物ではありません」の注記を
  入れてください
- Gemini の生成画像には SynthID の不可視ウォーターマークが入ります
  （無効化不可・画質への影響なし・商用利用の制限にはなりません）
