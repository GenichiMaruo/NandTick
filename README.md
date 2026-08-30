# NandTick

NandTickは、階層化されたデジタル回路をbit幅とtick伝搬遅延つきで実行する、完全ローカル動作のNext.js論理回路シミュレータです。

## 主な機能

- Canvasベースの回路エディタ（自由な配線曲げ、ドラッグ分岐・個別削除、矩形複数選択、移動、複製、コピー/貼り付け、undo/redo、zoom/中ボタンpan）
- ゲート記号を含む12種類の部品形状と、インスタンスごとの色・サイズ・形状カスタマイズ
- グラデーションを使わないStudioと、外周UIを5色で統一する5種類の保存可能なカラーパレット
- Misty Cocoa／Deep Navy／Lilac Candy／Garden Picnic／Sunset Sorbetに加え、毎回新しい5色を生成・手動編集できるMy Palette
- 全部品で選べるキャンバス内表示（シンボルのみ／ライブプレビュー／詳細展開）
- packed 4-state bit-vector（`0` / `1` / `X` / `Z`）と任意幅bus
- OUTPUTだけに許可されるLSB保持のzero-extensionと厳密な幅検証
- tick bucketを用いたevent-driven/transport-delayシミュレーション
- カスタム部品、階層展開、再帰依存防止、最大遅延/critical path解析
- tick単位のテストケースとSystemVerilog/Verilog HDL export
- 非同期read・同期writeの`RAM_256x8`、キャンバス内32/256 byte表示、memory inspector
- HEX sequence / `address: value`ファイルのREPLACE/PATCH preview、reload、export
- 16×16・4bppの`PICO88_DISPLAY`、キャンバス内ライブ画面、screen RAM / VRAM debugger
- IndexedDB autosave、named project、portable JSON import/export

## 起動

```bash
npm install
npm run dev
```

ブラウザで `http://localhost:3000` を開きます。シミュレーションやファイル解析にサーバー通信は使用しません。

## 検証

```bash
npm test
npm run build
```

`npm run build` は静的配布用の `out/` を生成します。
