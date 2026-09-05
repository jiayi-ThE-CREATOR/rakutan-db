/* 口コミ受け口の GAS ―― 2026-09-03 に「テストの難易度」列を足す直前の状態。
 *
 * これは **変更前の写し** です。戻すときはこのファイルを Apps Script エディタに
 * 貼り戻してください（デプロイのやり直しも要る。docs/plans/2026-09-03-... §11 参照）。
 *
 * 置き場所: しゅんやさんのスプレッドシート > 拡張機能 > Apps Script
 * 公開URL : worker/index.js:741 の KUCHIKOMI_GAS_URL とベタ書きで対応している
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
        "出欠", "授業中の課題", "授業外の課題", "テスト", "レポート有無", "レポート字数", "一言コメント"
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
