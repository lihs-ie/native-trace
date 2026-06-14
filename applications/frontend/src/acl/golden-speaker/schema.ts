/**
 * Golden Speaker ACL schema。
 * worker POST /golden-speaker/convert のレスポンスを Zod で検証する。
 *
 * ORPHAN-4: qualityGatePassed が false の場合、audioBase64 を無視すること。
 * M-GRV-7: targetVoice は API レスポンス由来 (静的 HTML に焼かない)。
 */

import { z } from "zod";

export const goldenConversionResponseSchema = z.object({
  audioBase64: z.string().nullable(),
  qualityGatePassed: z.boolean(),
  withholdReason: z.string().nullable(),
  targetVoice: z.string(),
});

export type GoldenConversionResponse = z.infer<typeof goldenConversionResponseSchema>;

/**
 * parseGoldenConversionResponse — worker レスポンスを検証し、
 * qualityGatePassed が false の場合は audioBase64 を null に強制する (ORPHAN-4)。
 */
export const parseGoldenConversionResponse = (raw: unknown): GoldenConversionResponse | null => {
  const result = goldenConversionResponseSchema.safeParse(raw);
  if (!result.success) return null;

  const parsed = result.data;

  // ORPHAN-4: qualityGatePassed=false 時は壊れた音声を再生しないため audioBase64 を無視
  if (!parsed.qualityGatePassed) {
    return { ...parsed, audioBase64: null };
  }

  return parsed;
};
