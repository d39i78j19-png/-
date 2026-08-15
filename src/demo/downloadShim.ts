/**
 * Artifact ビューア向けのファイル保存シム。
 *
 * 公開ページはページ自身が始めたダウンロード（a[download] や blob: リンク）を
 * 実行できない。代わりにビューアの downloads 機能を通すと、閲覧者に確認
 * ダイアログが出て保存される。ProjectBar の差し込み口（__personaStudioSaveFile）
 * にこの経路を登録する。
 *
 * downloads が使えない環境では何も登録しないので、ProjectBar は従来どおり
 * a[download] にフォールバックする。
 */

interface DownloadsNamespace {
  save(request: { filename: string; data: Blob }): Promise<{ status: "saved" }>;
}

interface ClaudeRuntime {
  use(name: "downloads"): Promise<DownloadsNamespace | null>;
}

/** 保存できなかった理由を、閲覧者が読んで分かる日本語にする。 */
const MESSAGES: Record<string, string> = {
  declined: "保存はキャンセルされました。",
  rate_limited: "保存の確認が続けて表示されたため中断しました。少し待って再度お試しください。",
  too_large: "設計データが大きすぎて保存できません（上限16MB）。",
  rejected_extension: "この形式のファイルは保存できません。",
  extension_not_enabled: "この形式のファイルは保存できません。",
};

export function installDownloadShim(): void {
  const runtime = (window as unknown as { claude?: ClaudeRuntime }).claude;
  if (!runtime?.use) return;

  window.__personaStudioSaveFile = async (filename, blob) => {
    const downloads = await runtime.use("downloads");
    if (!downloads) {
      throw new Error(
        "このページでは書き出しを利用できません。デスクトップアプリ版をお使いください。",
      );
    }
    try {
      await downloads.save({ filename, data: blob });
    } catch (error) {
      const code = (error as { code?: string } | null)?.code ?? "";
      throw new Error(MESSAGES[code] ?? "書き出しに失敗しました。");
    }
  };
}
