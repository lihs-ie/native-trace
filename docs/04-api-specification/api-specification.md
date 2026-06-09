---
title: "NativeTrace API仕様書"
version: "1.0.0"
status: "draft"
created: "2026-06-04"
last_updated: "2026-06-04"
author: "lihs"
---

# API仕様書

## 1. はじめに

### 1.1 目的

本文書は、NativeTrace ローカルMVPのNext.js Route Handler API仕様を定義する。対象はWeb UIが利用する同一オリジンAPIであり、題材、セクション、録音、解析ジョブ、履歴、音声再生を扱う。

### 1.2 ベースURL

| 環境 | ベースURL |
|---|---|
| 開発 | `http://localhost:3000/api/v1` |
| ローカルMVP | `/api/v1` |

MVP時点からURL pathにversionを含める。破壊的変更が必要になった場合は `/api/v2` を追加する。header versioningは採用しない。

### 1.3 関連文書

| 文書 | 参照内容 |
|---|---|
| [要件定義書](../01-requirements/requirements-specification.md) | APIが満たす機能要件 |
| [基本設計書](../02-system-design/system-design.md) | システム構成、外部IF |
| [詳細設計書](../03-detailed-design/detailed-design.md) | Route Handler、Range、Error mapping |
| [ユースケース層設計書](../03-detailed-design/use-case.md) | 対応UseCase |
| [インフラストラクチャ層設計書](../03-detailed-design/infrastructure.md) | AudioStorage、Range読み取り |
| [ACL設計書](../03-detailed-design/acl.md) | Engine結果DTO |

## 2. 共通仕様

### 2.1 リクエスト形式

| 項目 | 仕様 |
|---|---|
| JSON Content-Type | `application/json; charset=utf-8` |
| 音声投稿 Content-Type | `multipart/form-data` |
| 文字コード | UTF-8 |
| 日時フォーマット | UTC ISO 8601 |
| API version | URL pathの `/api/v1` |

### 2.2 認証方式

MVPではアプリ内ログイン機能を実装しない。APIは同一オリジンからのローカル利用を前提とし、認可用HTTPヘッダーを要求しない。

| 項目 | 方針 |
|---|---|
| 認証 | なし |
| CORS | 許可しない |
| CSRF | 本格公開時に再設計 |
| 外部公開 | 禁止 |

### 2.3 JSON表現

| 種別 | 表現 |
|---|---|
| 識別子 | `mat_...` 等の文字列。field名は `identifier` または関連先名 |
| 日時 | UTC ISO 8601文字列 |
| Choice Type | lower camel case文字列 |
| 未設定 | `null` |
| 空配列 | `[]` |
| duration/range | ミリ秒整数 |
| score | 0から100の整数 |
| confidence | 0から1の小数 |

自身の識別子は `identifier` とする。他リソース参照は `material`、`sectionSeries`、`section`、`recordingAttempt` のように関連先名で返す。旧来のID風フィールド名や参照先Identifier suffixフィールドは使わない。

### 2.4 ページング

一覧APIはoffset/limit方式に統一する。

| Query | 型 | default | 最大 | 説明 |
|---|---:|---:|---:|---|
| `offset` | integer | 0 | - | 取得開始位置 |
| `limit` | integer | 20 | 100 | 取得件数 |

レスポンス:

```json
{
  "data": [],
  "page": {
    "type": "offset",
    "offset": 0,
    "limit": 20,
    "total": 42
  },
  "meta": {
    "requestIdentifier": "req_01JZ0000000000000000000000"
  }
}
```

## 3. 共通レスポンス形式

### 3.1 成功レスポンス

```json
{
  "data": {},
  "meta": {
    "requestIdentifier": "req_01JZ0000000000000000000000"
  }
}
```

一覧取得では `page` を返す。

### 3.2 エラーレスポンス

```json
{
  "error": {
    "code": "validationFailed",
    "message": "入力値が不正です",
    "details": {
      "fieldErrors": [
        {
          "field": "title",
          "message": "必須です"
        }
      ]
    }
  },
  "meta": {
    "requestIdentifier": "req_01JZ0000000000000000000000"
  }
}
```

`message` は日本語とする。`details` はobjectとする。`cause`、OpenAI API key、raw response本文、ローカル絶対パスは返さない。

### 3.3 DomainError変換

| DomainError type | HTTP | error.code |
|---|---:|---|
| `validationFailed` | 400 | `validationFailed` |
| `notFound` | 404 | `notFound` |
| `invalidStateTransition` | 409 | `invalidStateTransition` |
| `persistenceFailed` | 500 | `persistenceFailed` |
| `transactionFailed` | 500 | `transactionFailed` |
| `audioStorageFailed` | 500 | `audioStorageFailed` |
| `assessmentEngineFailed` | 502 | `assessmentEngineFailed` |
| `assessmentSchemaInvalid` | 502 | `assessmentSchemaInvalid` |

## 4. 共通DTO

### 4.1 MaterialDto

```json
{
  "identifier": "mat_01JZ0000000000000000000000",
  "title": "TED: The power of introverts",
  "source": {
    "sourceType": "ted",
    "sourceUrl": "https://www.ted.com/...",
    "sourceTitle": "The power of introverts",
    "speakerName": "Susan Cain"
  },
  "createdAt": "2026-06-04T01:00:00.000Z",
  "updatedAt": "2026-06-04T01:00:00.000Z"
}
```

`source` は未設定時 `null`。

### 4.2 SectionSeriesDto

```json
{
  "identifier": "ssr_01JZ0000000000000000000000",
  "material": "mat_01JZ0000000000000000000000",
  "title": "Opening story",
  "displayOrder": 1,
  "createdAt": "2026-06-04T01:00:00.000Z",
  "updatedAt": "2026-06-04T01:00:00.000Z"
}
```

### 4.3 SectionDto

```json
{
  "identifier": "sec_01JZ0000000000000000000000",
  "sectionSeries": "ssr_01JZ0000000000000000000000",
  "version": 1,
  "bodyText": "When I was nine years old, I went off to summer camp...",
  "createdAt": "2026-06-04T01:00:00.000Z"
}
```

### 4.4 RecordingAttemptDto

```json
{
  "identifier": "rec_01JZ0000000000000000000000",
  "section": "sec_01JZ0000000000000000000000",
  "status": "ready",
  "origin": {
    "type": "browser_recording",
    "startedAt": "2026-06-04T01:07:50.000Z",
    "endedAt": "2026-06-04T01:10:00.000Z",
    "browserInfo": {
      "browserName": "Chrome",
      "browserVersion": "137",
      "deviceType": "desktop"
    }
  },
  "recordedDurationMs": 123456,
  "createdAt": "2026-06-04T01:00:00.000Z"
}
```

`origin` はChoice Typeである。`browser_recording` は `startedAt`、`endedAt`、`browserInfo` 必須。`uploaded_file` はこれらを持たず、`originalFileName` 必須とする。

`uploaded_file` の `origin` 例:

```json
{
  "type": "uploaded_file",
  "originalFileName": "practice-take-03.m4a",
  "uploadedAt": "2026-06-04T01:10:00.000Z"
}
```

### 4.5 AnalysisRunDto / AnalysisJobDto

```json
{
  "identifier": "run_01JZ0000000000000000000000",
  "recordingAttempt": "rec_01JZ0000000000000000000000",
  "status": "queued",
  "createdAt": "2026-06-04T01:00:00.000Z"
}
```

```json
{
  "identifier": "job_01JZ0000000000000000000000",
  "analysisRun": "run_01JZ0000000000000000000000",
  "engine": "cloud",
  "status": "queued",
  "attemptCount": 0
}
```

### 4.6 AssessmentResultDto

```json
{
  "identifier": "ars_01JZ0000000000000000000000",
  "analysisJob": "job_01JZ0000000000000000000000",
  "engine": "cloud",
  "scores": {
    "overall": 72,
    "accuracy": 86,
    "nativeLikeness": 61,
    "pronunciation": 78,
    "connectedSpeech": 55,
    "prosody": 64
  },
  "summary": {
    "messageJa": "本文一致は良好ですが、連結発話と強勢が弱いです。",
    "messageEn": "Accuracy is good, but connected speech and stress need work."
  },
  "findings": [
    {
      "identifier": "fin_01JZ0000000000000000000000",
      "category": "connectedSpeech",
      "severity": "major",
      "textRange": {
        "startChar": 12,
        "endChar": 21
      },
      "audioRange": {
        "startMilliseconds": 1480,
        "endMilliseconds": 2260
      },
      "expected": {
        "text": "want to",
        "ipa": "wɑnə"
      },
      "detected": {
        "text": "want to",
        "ipa": "wɑnt tu"
      },
      "messageJa": "弱形と連結が不足しています。",
      "messageEn": "The weak form and linking are insufficient.",
      "scoreImpact": 8,
      "confidence": 0.91
    }
  ],
  "metadata": {
    "assessmentSchemaVersion": "1",
    "scoringRubricVersion": "rubric-v1",
    "promptVersion": "prompt-v1",
    "model": "configured-model",
    "workerVersion": null,
    "modelVersion": null,
    "ruleSetVersion": null,
    "engineSpecific": {}
  },
  "tokenizerVersion": "native-trace-tokenizer-v1",
  "engineSnapshot": {
    "kind": "cloud",
    "displayName": "OpenAI"
  },
  "createdAt": "2026-06-04T01:00:00.000Z"
}
```

`findings[].identifier` は正式なAssessmentResultで必須であり、`HighlightRangeDto.finding` は同じ値を参照する。categoryは `accuracy | pronunciation | connectedSpeech | prosody | nativeLikeness` に限定する。raw responseは通常のAPI DTOには含めないが、Domain/DBでは保持する。

### 4.7 HighlightRangeDto

```json
{
  "finding": "fin_01JZ0000000000000000000000",
  "severity": "major",
  "category": "connectedSpeech",
  "textRange": {
    "startChar": 10,
    "endChar": 28
  },
  "tokenRange": {
    "startTokenIndex": 2,
    "endTokenIndex": 5
  },
  "audioRange": {
    "startMilliseconds": 1200,
    "endMilliseconds": 2460
  },
  "messageJa": "語間のリンキングが弱く、単語ごとに切れて聞こえます。",
  "messageEn": "The linking is weak and sounds word-by-word.",
  "confidence": 0.82
}
```

## 5. エンドポイント一覧

| ID | Method | Path | UseCase | 成功 |
|---|---|---|---|---|
| API-001 | GET | `/api/v1/materials` | `browsePracticeMaterials` | 200 |
| API-002 | POST | `/api/v1/materials` | `prepareMaterial` | 201 |
| API-003 | PATCH | `/api/v1/materials/{materialIdentifier}` | `reviseMaterial` | 200 |
| API-004 | DELETE | `/api/v1/materials/{materialIdentifier}` | `retireMaterial` | 200 |
| API-005 | GET | `/api/v1/materials/{materialIdentifier}/practice-plan` | `viewMaterialPracticePlan` | 200 |
| API-006 | POST | `/api/v1/materials/{materialIdentifier}/section-series` | `definePracticeSection` | 201 |
| API-007 | PATCH | `/api/v1/section-series/{sectionSeriesIdentifier}` | `revisePracticeSection` | 200 |
| API-008 | DELETE | `/api/v1/section-series/{sectionSeriesIdentifier}` | `retirePracticeSectionSeries` | 200 |
| API-009 | GET | `/api/v1/sections/{sectionIdentifier}/workspace` | `viewPracticeWorkspace` | 200 |
| API-010 | POST | `/api/v1/sections/{sectionIdentifier}/practice-attempts` | `submitPracticeAttempt` | 202 |
| API-011 | POST | `/api/v1/recording-attempts/{recordingAttemptIdentifier}/analysis-runs` | `reassessPracticeAttempt` | 202 |
| API-012 | POST | `/api/v1/analysis-runs/{analysisRunIdentifier}/cancel` | `cancelAssessmentRun` | 202 |
| API-013 | GET | `/api/v1/history` | `reviewPracticeHistory` | 200 |
| API-014 | DELETE | `/api/v1/recording-attempts/{recordingAttemptIdentifier}` | `discardRecordingAttempt` | 200 |
| API-015 | DELETE | `/api/v1/analysis-runs/{analysisRunIdentifier}` | `discardAssessmentRun` | 200 |
| API-016 | GET | `/api/v1/recording-attempts/{recordingAttemptIdentifier}/audio` | `openRecordingAudio` | 200 / 206 |

`runAssessmentJob` はHTTP endpointを持たない。

## 6. エンドポイント詳細

### API-001: 題材一覧取得 <a id="api-001"></a>

| 項目 | 内容 |
|---|---|
| Method | `GET` |
| Path | `/api/v1/materials` |
| 成功 | `200 OK` |

Query:

| name | 型 | 必須 | 説明 |
|---|---|---|---|
| `offset` | integer | No | default 0 |
| `limit` | integer | No | default 20, max 100 |

Response:

```json
{
  "data": [
    {
      "identifier": "mat_01JZ0000000000000000000000",
      "title": "TED: The power of introverts",
      "source": null,
      "createdAt": "2026-06-04T01:00:00.000Z",
      "updatedAt": "2026-06-04T01:00:00.000Z"
    }
  ],
  "page": {
    "type": "offset",
    "offset": 0,
    "limit": 20,
    "total": 1
  },
  "meta": {
    "requestIdentifier": "req_01JZ0000000000000000000000"
  }
}
```

### API-002: 題材作成 <a id="api-002"></a>

| 項目 | 内容 |
|---|---|
| Method | `POST` |
| Path | `/api/v1/materials` |
| 成功 | `201 Created` |

Request:

```json
{
  "title": "TED: The power of introverts",
  "source": {
    "sourceType": "ted",
    "sourceUrl": "https://www.ted.com/...",
    "sourceTitle": "The power of introverts",
    "speakerName": "Susan Cain"
  }
}
```

`title` は必須。`source` は任意で、未設定時は省略可。

Response:

```json
{
  "data": {
    "material": {
      "identifier": "mat_01JZ0000000000000000000000",
      "title": "TED: The power of introverts",
      "source": {
        "sourceType": "ted",
        "sourceUrl": "https://www.ted.com/...",
        "sourceTitle": "The power of introverts",
        "speakerName": "Susan Cain"
      },
      "createdAt": "2026-06-04T01:00:00.000Z",
      "updatedAt": "2026-06-04T01:00:00.000Z"
    }
  },
  "meta": {
    "requestIdentifier": "req_01JZ0000000000000000000000"
  }
}
```

### API-003: 題材更新 <a id="api-003"></a>

| 項目 | 内容 |
|---|---|
| Method | `PATCH` |
| Path | `/api/v1/materials/{materialIdentifier}` |
| 成功 | `200 OK` |

Request:

```json
{
  "title": "TED: The power of introverts",
  "source": null
}
```

`title` と `source` は任意だが、少なくとも1つを指定する。

Response:

```json
{
  "data": {
    "material": {
      "identifier": "mat_01JZ0000000000000000000000",
      "title": "TED: The power of introverts",
      "source": null,
      "createdAt": "2026-06-04T01:00:00.000Z",
      "updatedAt": "2026-06-04T01:10:00.000Z"
    }
  },
  "meta": {
    "requestIdentifier": "req_01JZ0000000000000000000000"
  }
}
```

### API-004: 題材削除 <a id="api-004"></a>

| 項目 | 内容 |
|---|---|
| Method | `DELETE` |
| Path | `/api/v1/materials/{materialIdentifier}` |
| 成功 | `200 OK` |

Response:

```json
{
  "data": {
    "identifier": "mat_01JZ0000000000000000000000",
    "status": "deleted"
  },
  "meta": {
    "requestIdentifier": "req_01JZ0000000000000000000000"
  }
}
```

### API-005: 練習計画取得 <a id="api-005"></a>

| 項目 | 内容 |
|---|---|
| Method | `GET` |
| Path | `/api/v1/materials/{materialIdentifier}/practice-plan` |
| 成功 | `200 OK` |

Response:

```json
{
  "data": {
    "material": {
      "identifier": "mat_01JZ0000000000000000000000",
      "title": "TED: The power of introverts",
      "source": null,
      "createdAt": "2026-06-04T01:00:00.000Z",
      "updatedAt": "2026-06-04T01:00:00.000Z"
    },
    "sectionSeries": [
      {
        "sectionSeries": {
          "identifier": "ssr_01JZ0000000000000000000000",
          "material": "mat_01JZ0000000000000000000000",
          "title": "Opening story",
          "displayOrder": 1,
          "createdAt": "2026-06-04T01:00:00.000Z",
          "updatedAt": "2026-06-04T01:00:00.000Z"
        },
        "latestSection": {
          "identifier": "sec_01JZ0000000000000000000000",
          "sectionSeries": "ssr_01JZ0000000000000000000000",
          "version": 1,
          "bodyText": "When I was nine years old...",
          "createdAt": "2026-06-04T01:00:00.000Z"
        },
        "versions": [
          {
            "identifier": "sec_01JZ0000000000000000000000",
            "version": 1,
            "createdAt": "2026-06-04T01:00:00.000Z"
          }
        ]
      }
    ]
  },
  "meta": {
    "requestIdentifier": "req_01JZ0000000000000000000000"
  }
}
```

### API-006: セクション作成 <a id="api-006"></a>

| 項目 | 内容 |
|---|---|
| Method | `POST` |
| Path | `/api/v1/materials/{materialIdentifier}/section-series` |
| 成功 | `201 Created` |

Request:

```json
{
  "title": "Opening story",
  "displayOrder": 1,
  "bodyText": "When I was nine years old, I went off to summer camp..."
}
```

`title`、`displayOrder`、`bodyText` は必須。`title` はtrim後の空文字を拒否する。初版Sectionの `version` は1。

Response:

```json
{
  "data": {
    "sectionSeries": {
      "identifier": "ssr_01JZ0000000000000000000000",
      "material": "mat_01JZ0000000000000000000000",
      "title": "Opening story",
      "displayOrder": 1,
      "createdAt": "2026-06-04T01:00:00.000Z",
      "updatedAt": "2026-06-04T01:00:00.000Z"
    },
    "section": {
      "identifier": "sec_01JZ0000000000000000000000",
      "sectionSeries": "ssr_01JZ0000000000000000000000",
      "version": 1,
      "bodyText": "When I was nine years old, I went off to summer camp...",
      "createdAt": "2026-06-04T01:00:00.000Z"
    }
  },
  "meta": {
    "requestIdentifier": "req_01JZ0000000000000000000000"
  }
}
```

### API-007: セクション系列改訂 <a id="api-007"></a>

| 項目 | 内容 |
|---|---|
| Method | `PATCH` |
| Path | `/api/v1/section-series/{sectionSeriesIdentifier}` |
| 成功 | `200 OK` |

Request:

```json
{
  "title": "Opening anecdote",
  "displayOrder": 2,
  "bodyText": "When I was nine years old, I went off to summer camp..."
}
```

`title`、`displayOrder`、`bodyText` は任意だが、少なくとも1つを指定する。`title` を指定する場合はtrim後の空文字を拒否する。`bodyText` が指定された場合だけ新しいSection本文版を作成する。

Response:

```json
{
  "data": {
    "sectionSeries": {
      "identifier": "ssr_01JZ0000000000000000000000",
      "material": "mat_01JZ0000000000000000000000",
      "title": "Opening anecdote",
      "displayOrder": 2,
      "createdAt": "2026-06-04T01:00:00.000Z",
      "updatedAt": "2026-06-04T01:10:00.000Z"
    },
    "createdSection": {
      "identifier": "sec_01JZ0000000000000000000001",
      "sectionSeries": "ssr_01JZ0000000000000000000000",
      "version": 2,
      "bodyText": "When I was nine years old, I went off to summer camp...",
      "createdAt": "2026-06-04T01:10:00.000Z"
    }
  },
  "meta": {
    "requestIdentifier": "req_01JZ0000000000000000000000"
  }
}
```

本文変更なしの場合、`createdSection` は `null`。

### API-008: セクション系列削除 <a id="api-008"></a>

| 項目 | 内容 |
|---|---|
| Method | `DELETE` |
| Path | `/api/v1/section-series/{sectionSeriesIdentifier}` |
| 成功 | `200 OK` |

Response:

```json
{
  "data": {
    "identifier": "ssr_01JZ0000000000000000000000",
    "status": "deleted"
  },
  "meta": {
    "requestIdentifier": "req_01JZ0000000000000000000000"
  }
}
```

### API-009: 練習ワークスペース取得 <a id="api-009"></a>

| 項目 | 内容 |
|---|---|
| Method | `GET` |
| Path | `/api/v1/sections/{sectionIdentifier}/workspace` |
| 成功 | `200 OK` |

クライアントは解析中、1から2秒間隔でこのAPIをポーリングする。

Response例は省略版:

```json
{
  "data": {
    "material": {},
    "sectionSeries": {},
    "section": {},
    "sectionTokens": [],
    "recordingAttempts": [],
    "latestAnalysisRun": {
      "identifier": "run_01JZ0000000000000000000000",
      "status": "running"
    },
    "resultsByEngine": [
      {
        "engine": "cloud",
        "result": {}
      },
      {
        "engine": "oss_worker",
        "result": null
      }
    ],
    "highlightRangesByEngine": [
      {
        "engine": "cloud",
        "highlights": []
      },
      {
        "engine": "oss_worker",
        "highlights": []
      }
    ]
  },
  "meta": {
    "requestIdentifier": "req_01JZ0000000000000000000000",
    "serverTime": "2026-06-04T01:10:00.000Z"
  }
}
```

統合スコア、統合ハイライトは返さない。`highlightRangesByEngine` はUI非依存DTOであり、色やレイアウトは含めない。

### API-010: 録音投稿と解析開始 <a id="api-010"></a>

| 項目 | 内容 |
|---|---|
| Method | `POST` |
| Path | `/api/v1/sections/{sectionIdentifier}/practice-attempts` |
| Content-Type | `multipart/form-data` |
| 成功 | `202 Accepted` |

FormData:

| field | 必須 | 内容 |
|---|---|---|
| `audio` | Yes | 録音/アップロード音声ファイル |
| `audioSource` | Yes | `browser_recording` または `uploaded_file` |
| `analysisMode` | Yes | `cloudOnly` / `ossWorkerOnly` / `comparison` |
| `recordedDurationMs` | Yes | 録音時間。最大10分 |
| `startedAt` | 条件付き | `browser_recording` で必須。ISO 8601 |
| `endedAt` | 条件付き | `browser_recording` で必須。ISO 8601 |
| `browserInfo` | 条件付き | `browser_recording` で必須のJSON文字列 |
| `originalFileName` | 条件付き | `uploaded_file` で必須 |

録音元はChoice Typeとして検証する。`browser_recording` では `startedAt`、`endedAt`、`browserInfo` をすべて要求し、`originalFileName` は受け付けない。`uploaded_file` では `originalFileName` を要求し、録音時刻とブラウザ情報は要求しない。

Example:

```http
POST /api/v1/sections/sec_01JZ0000000000000000000000/practice-attempts
Content-Type: multipart/form-data

audio=@recording.webm
audioSource=browser_recording
analysisMode=comparison
recordedDurationMs=123456
startedAt=2026-06-04T01:07:50.000Z
endedAt=2026-06-04T01:10:00.000Z
browserInfo={"browserName":"Chrome","browserVersion":"137","deviceType":"desktop"}
```

Response:

```json
{
  "data": {
    "recordingAttempt": {
      "identifier": "rec_01JZ0000000000000000000000",
      "section": "sec_01JZ0000000000000000000000",
      "status": "ready",
      "origin": {
        "type": "browser_recording",
        "startedAt": "2026-06-04T01:07:50.000Z",
        "endedAt": "2026-06-04T01:10:00.000Z",
        "browserInfo": {
          "browserName": "Chrome",
          "browserVersion": "137",
          "deviceType": "desktop"
        }
      },
      "recordedDurationMs": 123456,
      "createdAt": "2026-06-04T01:10:00.000Z"
    },
    "analysisRun": {
      "identifier": "run_01JZ0000000000000000000000",
      "recordingAttempt": "rec_01JZ0000000000000000000000",
      "status": "queued",
      "createdAt": "2026-06-04T01:10:00.000Z"
    },
    "analysisJobs": [
      {
        "identifier": "job_01JZ0000000000000000000000",
        "analysisRun": "run_01JZ0000000000000000000000",
        "engine": "cloud",
        "status": "queued",
        "attemptCount": 0
      },
      {
        "identifier": "job_01JZ0000000000000000000001",
        "analysisRun": "run_01JZ0000000000000000000000",
        "engine": "oss_worker",
        "status": "queued",
        "attemptCount": 0
      }
    ]
  },
  "meta": {
    "requestIdentifier": "req_01JZ0000000000000000000000"
  }
}
```

### API-011: 再解析開始 <a id="api-011"></a>

| 項目 | 内容 |
|---|---|
| Method | `POST` |
| Path | `/api/v1/recording-attempts/{recordingAttemptIdentifier}/analysis-runs` |
| 成功 | `202 Accepted` |

Request:

```json
{
  "analysisMode": "comparison"
}
```

Response:

```json
{
  "data": {
    "analysisRun": {
      "identifier": "run_01JZ0000000000000000000001",
      "recordingAttempt": "rec_01JZ0000000000000000000000",
      "status": "queued",
      "createdAt": "2026-06-04T01:20:00.000Z"
    },
    "analysisJobs": [
      {
        "identifier": "job_01JZ0000000000000000000002",
        "analysisRun": "run_01JZ0000000000000000000001",
        "engine": "cloud",
        "status": "queued",
        "attemptCount": 0
      },
      {
        "identifier": "job_01JZ0000000000000000000003",
        "analysisRun": "run_01JZ0000000000000000000001",
        "engine": "oss_worker",
        "status": "queued",
        "attemptCount": 0
      }
    ]
  },
  "meta": {
    "requestIdentifier": "req_01JZ0000000000000000000000"
  }
}
```

既存結果は上書きしない。

### API-012: 解析実行キャンセル <a id="api-012"></a>

| 項目 | 内容 |
|---|---|
| Method | `POST` |
| Path | `/api/v1/analysis-runs/{analysisRunIdentifier}/cancel` |
| 成功 | `202 Accepted` |

Response:

```json
{
  "data": {
    "analysisRun": {
      "identifier": "run_01JZ0000000000000000000000",
      "status": "partial_succeeded"
    },
    "canceledJobs": [
      "job_01JZ0000000000000000000000"
    ]
  },
  "meta": {
    "requestIdentifier": "req_01JZ0000000000000000000000"
  }
}
```

キャンセルは未完了Jobだけを更新し、応答の `analysisRun.status` は更新後の全Jobから派生計算する。全Job canceledなら`canceled`、成功済みJobがあり残りをcancelした場合は例のように`partial_succeeded`となる。全Jobが既に終端状態のrunは `409 invalidStateTransition`。

### API-013: 履歴取得 <a id="api-013"></a>

| 項目 | 内容 |
|---|---|
| Method | `GET` |
| Path | `/api/v1/history` |
| 成功 | `200 OK` |

Query:

| name | 型 | 必須 | 説明 |
|---|---|---|---|
| `material` | string | No | Materialで絞り込み |
| `sectionSeries` | string | No | SectionSeriesで絞り込み |
| `offset` | integer | No | default 0 |
| `limit` | integer | No | default 20, max 100 |

`material` と `sectionSeries` が両方指定された場合はAND条件。

Response:

```json
{
  "data": [
    {
      "sectionSeries": {},
      "sections": [
        {
          "section": {},
          "recordingAttempts": [],
          "analysisRuns": []
        }
      ]
    }
  ],
  "page": {
    "type": "offset",
    "offset": 0,
    "limit": 20,
    "total": 1
  },
  "meta": {
    "requestIdentifier": "req_01JZ0000000000000000000000"
  }
}
```

削除済み録音、削除済みAnalysisRunは通常返さない。

### API-014: 録音試行削除 <a id="api-014"></a>

| 項目 | 内容 |
|---|---|
| Method | `DELETE` |
| Path | `/api/v1/recording-attempts/{recordingAttemptIdentifier}` |
| 成功 | `200 OK` |

Response:

```json
{
  "data": {
    "identifier": "rec_01JZ0000000000000000000000",
    "status": "deleted",
    "physicalAudioDeletion": {
      "status": "succeeded"
    }
  },
  "meta": {
    "requestIdentifier": "req_01JZ0000000000000000000000"
  }
}
```

音声物理削除失敗時は、DB論理削除済みであっても `audioStorageFailed` errorを返し、AudioFileを `delete_failed` として残す。同じDELETEを再実行すると、削除済みRecordingAttemptでもAudioFileが `deletion_pending` / `delete_failed` なら物理削除を再試行する。既に `physically_deleted` なら同じ成功レスポンスを返す冪等操作とする。MVPでは専用cleanup endpoint/jobを追加しない。

### API-015: 解析実行削除 <a id="api-015"></a>

| 項目 | 内容 |
|---|---|
| Method | `DELETE` |
| Path | `/api/v1/analysis-runs/{analysisRunIdentifier}` |
| 成功 | `200 OK` |

Response:

```json
{
  "data": {
    "identifier": "run_01JZ0000000000000000000000",
    "status": "deleted"
  },
  "meta": {
    "requestIdentifier": "req_01JZ0000000000000000000000"
  }
}
```

録音試行と音声ファイルは残す。

### API-016: 録音音声取得 <a id="api-016"></a>

| 項目 | 内容 |
|---|---|
| Method | `GET` |
| Path | `/api/v1/recording-attempts/{recordingAttemptIdentifier}/audio` |
| 成功 | `200 OK` / `206 Partial Content` |

通常時はJSON wrapperなしの音声バイナリを返す。エラー時のみJSON error bodyを返す。

Request header:

```http
Range: bytes=0-1048575
```

Response `206 Partial Content`:

```http
HTTP/1.1 206 Partial Content
Content-Type: audio/webm
Accept-Ranges: bytes
Content-Length: 1048576
Content-Range: bytes 0-1048575/7340032
```

| 条件 | HTTP |
|---|---|
| Rangeなし | `200 OK` |
| 有効なRangeあり | `206 Partial Content` |
| 不正Range | `416 Range Not Satisfiable` |
| 削除済み録音/音声 | `404 notFound` |

ローカルファイルパスやstorage keyは返さない。

## 7. エンドポイント別主なエラー

| API | 主なエラー |
|---|---|
| API-001 | `validationFailed`, `persistenceFailed` |
| API-002 | `validationFailed`, `persistenceFailed` |
| API-003 | `validationFailed`, `notFound`, `invalidStateTransition` |
| API-004 | `notFound`, `invalidStateTransition`, `transactionFailed` |
| API-005 | `notFound` |
| API-006 | `validationFailed`, `notFound`, `invalidStateTransition`, `transactionFailed` |
| API-007 | `validationFailed`, `notFound`, `invalidStateTransition`, `transactionFailed` |
| API-008 | `notFound`, `invalidStateTransition`, `transactionFailed` |
| API-009 | `notFound` |
| API-010 | `validationFailed`, `notFound`, `invalidStateTransition`, `audioStorageFailed`, `transactionFailed` |
| API-011 | `validationFailed`, `notFound`, `invalidStateTransition`, `transactionFailed` |
| API-012 | `notFound`, `invalidStateTransition`, `transactionFailed` |
| API-013 | `validationFailed`, `notFound` |
| API-014 | `notFound`, `invalidStateTransition`, `audioStorageFailed`, `transactionFailed` |
| API-015 | `notFound`, `invalidStateTransition`, `transactionFailed` |
| API-016 | `notFound`, `audioStorageFailed` |

## 変更履歴

| バージョン | 日付 | 変更者 | 変更内容 |
|---|---|---|---|
| 1.0.0 | 2026-06-04 | lihs | 初版作成 |
