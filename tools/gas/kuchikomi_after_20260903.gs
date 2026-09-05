/* 口コミ受け口の GAS ―― 2026-09-03「テストの難易度」列を足した版。
 *
 * 変更は2か所だけ（どちらも配列に1つ足しただけ）:
 *   1. 見出しの自動作成に "テストの難易度" を追加（"テスト" の直後）
 *   2. 書き込む行に Number(...examDifficulty) || "" を追加（同じ位置）
 *
 * ★ 配列の順番 = シートの列の順番。片方だけ直すと、以降の全部が1つずれます。
 * ★ シート側は O列「テスト」の右に1列挿入し、見出しを「テストの難易度」にすること。
 *
 * examDifficulty はフォームから文字列（"7"）で届くので Number() で数値にする。
 * テストが無かった回は null で届き、Number(null) は 0 → 偽 → "" になるので空欄。
 * 0 を書かないのが大事（「テスト無し」と「難易度0＝簡単」を区別できなくなる）。
 * 難易度は 1〜10 なので、0 になるのはテストが無かった回だけ。
 */
function doPost(e) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    const data = JSON.parse(e.postData.contents);
    
    // 1行目にヘッダー（見出し）がない場合は自動作成
    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
        "タイムスタンプ", "学年", "学期", "学部", "学科",
        "科目コード", "科目名", "教員名", "曜日", "時限", "受講年度",
        "出欠", "授業中の課題", "授業外の課題", "テスト", "テストの難易度",
        "レポート有無", "レポート字数", "一言コメント"
      ]);
    }
    
    const timestamp = new Date();
    const rows = [];
    
    // 送信されてきた複数の科目データを配列に変換
    data.selections.forEach(sel => {
      rows.push([
        timestamp,
        data.grade || "",
        data.semester || "",
        data.faculty || "",
        data.department || "",
        sel.subject.id || "",
        sel.subject.name || "",
        sel.subject.teacher || "",
        sel.day || "",
        sel.period || "",
        sel.subject.review.yearTaken || "",
        sel.subject.review.attendance || "",
        sel.subject.review.assignmentInClass || "",
        sel.subject.review.assignmentOutClass || "",
        sel.subject.review.exam || "",
        Number(sel.subject.review.examDifficulty) || "",
        sel.subject.review.reportPresence || "",
        sel.subject.review.reportWordCount || "",
        sel.subject.review.comment || ""
      ]);
    });
    
    // スプレッドシートに一括書き込み
    if (rows.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    }
    
    // 成功レスポンスを返す
    return ContentService.createTextOutput(JSON.stringify({ status: "success" }))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    // エラーレスポンスを返す
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
