# rubric pack: Next.js

async Server Components は unit test に限界があるため E2E が特に重要。
「ボタン→Server Action / Route Handler→DB→再描画」の **read-back** 検証を最優先に置く。

## 追加判定項目
- UI interaction 後に **expected API / Server Action が呼ばれた** (network request が飛ぶ)。
- `revalidatePath` / cache 更新後の **reload でも状態が維持** された (success toast は証拠にしない)。
- async Server Component 経路は **user-journey E2E** (Playwright) で確認された。
- 本番コードに test helper / mock が混入していない。
- **空 `__tests__` ディレクトリ / テスト 0 件は done でない**。`__tests__` を作っただけ・テストファイルが
  空 (case 0) の状態を done 報告に使わない。変更したコンポーネント / feature には **1 件以上 pass する
  テスト**が必要 (テストが無いのと空テストが緑なのは同義で、いずれも実装の証拠にならない / FC-4)。
- **spec の acceptance に Playwright (E2E) を含む screen / feature は、E2E の実行を done の必須証拠にする**。
  Playwright test ファイルを置いただけ・未実行は done でない。`.agent-evidence/` に Playwright 実行ログ
  (pass 結果 / trace) を残す。「E2E スキップで unit 緑だから done」は却下する (FC-4)。

## 推奨証拠
- Playwright trace (CI 失敗時の原因特定)。
- 操作後の network assertion + reload 後の状態 assertion。
- unit test は schema / mapper / pure function に限定。
