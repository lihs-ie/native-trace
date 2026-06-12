# rubric pack: Next.js

async Server Components は unit test に限界があるため E2E が特に重要。
「ボタン→Server Action / Route Handler→DB→再描画」の **read-back** 検証を最優先に置く。

## 追加判定項目
- UI interaction 後に **expected API / Server Action が呼ばれた** (network request が飛ぶ)。
- `revalidatePath` / cache 更新後の **reload でも状態が維持** された (success toast は証拠にしない)。
- async Server Component 経路は **user-journey E2E** (Playwright) で確認された。
- 本番コードに test helper / mock が混入していない。

## 推奨証拠
- Playwright trace (CI 失敗時の原因特定)。
- 操作後の network assertion + reload 後の状態 assertion。
- unit test は schema / mapper / pure function に限定。
