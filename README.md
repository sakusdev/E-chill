# E-chill

ブラウザ内で無限にチルミュージックを生成するWebアプリです。Web Audio APIを使うため、音声ファイルや外部APIは不要です。

## 開発

```bash
npm install
npm run dev
```

本番ビルド:

```bash
npm run build
```

## Cloudflare Pages Automatic Deploy

Cloudflare Dashboardで **Workers & Pages → Create → Pages → Connect to Git** を開き、このGitHubリポジトリを選択します。

- Framework preset: `Vite`
- Build command: `npm run build`
- Build output directory: `dist`
- Root directory: `/`

以後、接続したブランチへのpushごとにCloudflare Pagesが自動デプロイします。

## 現在の生成ロジック

- Cメジャーを中心とした `maj7 / m7 / dim7 / m6 / 13sus` の遷移
- `Cmaj7 → C♯dim7 → Dm7` と `Fmaj7 → Fm6 → C` を含む重み付き進行
- パッド、ベース、ベル系メロディ、簡易ローファイドラム
- Energy / Warmth / Variationのリアルタイム調整
- 数小節先を先行スケジュールして途切れを防止

## Roadmap

- モチーフ記憶と変形
- セクション遷移と長期的なムード変化
- より自然なボイスリーディング
- オフライン対応（PWA）
- MIDI書き出し
