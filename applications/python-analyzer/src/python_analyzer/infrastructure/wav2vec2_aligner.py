"""wav2vec2 phoneme-CTC + torchaudio 強制整列による GOP 計算インフラ実装。

モデル: facebook/wav2vec2-lv-60-espeak-cv-ft（Apache-2.0, ungated）
デバイス: CPU のみ（torch.device("cpu") は本ファイル内に閉じ込める）
"""

import io
import logging
import math
import subprocess
from typing import Any  # noqa: UP035

import soundfile as sf  # type: ignore[import-untyped]
import torch
import torchaudio  # type: ignore[import-untyped]
from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor  # type: ignore[import-untyped]

from python_analyzer.domain.audio import AudioInput
from python_analyzer.domain.measurement import NBestCandidate, PhonemeGopMeasurement
from python_analyzer.domain.phoneme import (
    AlignmentBoundary,
    GopScore,
    IpaSequence,
    PhonemeLabel,
)
from python_analyzer.infrastructure.audio_energy import (
    compute_speech_active_rms,
    compute_speech_duration_seconds_from_energy,
)

logger = logging.getLogger(__name__)


def top_n_phonemes(
    avg_probs: "torch.Tensor",
    vocabulary: list[str],
    n: int = 3,
) -> tuple[NBestCandidate, ...]:
    """softmax 確率テンソルから上位 n 件の IPA 候補を返す純関数。

    Args:
        avg_probs: shape (V,) の softmax 確率テンソル（1 音素フレーム区間の平均値）。
        vocabulary: モデルの語彙リスト（wav2vec2 vocab）。
        n: 取得する上位候補数（デフォルト 3）。

    Returns:
        確率降順で上位 n 件の NBestCandidate タプル。
        特殊トークン (<pad>/<unk>/<s>/</s>/|) は除外。
    """
    special_tokens = {"<pad>", "<unk>", "<s>", "</s>", "|", ""}
    # 確率降順でソートしてインデックスを取得する
    sorted_indices = torch.argsort(avg_probs, descending=True)
    candidates: list[NBestCandidate] = []
    for idx in sorted_indices.tolist():
        if len(candidates) >= n:
            break
        if idx >= len(vocabulary):
            continue
        token = vocabulary[idx]
        if token in special_tokens:
            continue
        confidence = float(avg_probs[idx].item())
        candidates.append(NBestCandidate(phoneme=token, confidence=confidence))
    return tuple(candidates)


# Hugging Face モデル ID（ADR-001 で確定）
_MODEL_ID = "facebook/wav2vec2-lv-60-espeak-cv-ft"
# CPU のみ使用（infrastructure 内に閉じ込める）
_DEVICE = torch.device("cpu")
# wav2vec2 が期待するサンプリングレート
_TARGET_SAMPLE_RATE = 16000
# フレーム長（ms）: wav2vec2 の stride
_FRAME_DURATION_MS = 20


class Wav2Vec2Aligner:
    """wav2vec2 モデルを使った音声整列・GOP 計算実装。

    初回呼び出し時にモデルをロードする（lazy initialization）。
    HF キャッシュは compose の volume マウントにより永続化される。
    """

    def __init__(self) -> None:
        self._processor: Any = None
        self._model: Any = None

    def _ensure_model_loaded(self) -> None:
        """モデルが未ロードなら HF からロード（またはキャッシュから取得）する。"""
        if self._model is not None:
            return
        logger.info("wav2vec2 モデルをロードする: %s", _MODEL_ID)
        self._processor = Wav2Vec2Processor.from_pretrained(_MODEL_ID)
        self._model = Wav2Vec2ForCTC.from_pretrained(_MODEL_ID)
        self._model = self._model.to(_DEVICE)
        self._model.eval()
        logger.info("wav2vec2 モデルのロード完了")

    def _decode_to_pcm(self, content: bytes, mime_type: str) -> bytes:
        """WebM/OGG 等の非 PCM フォーマットを WAV PCM に変換する。

        soundfile は libsndfile バックエンドのため WebM を直接読めない。
        ffmpeg subprocess を使って WebM/OGG/MP4 等を WAV PCM に変換する。
        WAV / FLAC / AU 等の soundfile が直接読める形式は変換をスキップする。
        """
        soundfile_native_mimes = {
            "audio/wav",
            "audio/x-wav",
            "audio/wave",
            "audio/flac",
            "audio/x-flac",
            "audio/aiff",
            "audio/x-aiff",
        }
        normalized_mime = mime_type.split(";")[0].strip().lower()
        if normalized_mime in soundfile_native_mimes:
            return content

        logger.info("ffmpeg で %s を WAV PCM に変換する", mime_type)
        result = subprocess.run(
            [
                "ffmpeg",
                "-nostdin",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                "pipe:0",
                "-f",
                "wav",
                "-acodec",
                "pcm_s16le",
                "pipe:1",
            ],
            input=content,
            capture_output=True,
            timeout=30,
        )
        if result.returncode != 0:
            raise RuntimeError(
                f"ffmpeg デコード失敗 (mime={mime_type}): {result.stderr.decode(errors='replace')}"
            )
        return result.stdout

    def _load_audio_tensor(self, audio: AudioInput) -> torch.Tensor:
        """AudioInput のバイナリを 16kHz モノ float32 テンソルに変換する。

        torchaudio 2.9+ は TorchCodec 依存で BytesIO 読み込みに問題があるため、
        soundfile で直接読み込んで torch.Tensor に変換する。
        WebM/OGG 等の soundfile 非対応形式は ffmpeg で WAV PCM に変換してから読む。
        """
        pcm_bytes = self._decode_to_pcm(audio.content, audio.mime_type)
        audio_buffer = io.BytesIO(pcm_bytes)
        # soundfile で読み込む（float32 に正規化される）
        data, sample_rate = sf.read(audio_buffer, dtype="float32", always_2d=True)
        # (samples, channels) -> (channels, samples) に変換する
        waveform = torch.from_numpy(data.T)
        # モノラル化する
        if waveform.shape[0] > 1:
            waveform = waveform.mean(dim=0, keepdim=True)
        # リサンプリングする
        if sample_rate != _TARGET_SAMPLE_RATE:
            resampler = torchaudio.transforms.Resample(sample_rate, _TARGET_SAMPLE_RATE)
            waveform = resampler(waveform)
        return waveform.squeeze(0)

    def _run_ctc_inference(self, waveform: torch.Tensor) -> tuple[torch.Tensor, list[str]]:
        """CTC 推論を実行してログ事後確率と語彙を返す。

        Returns:
            log_probs: shape (T, V) の log softmax テンソル。
            vocabulary: モデルの語彙リスト（音素ラベル）。
        """
        self._ensure_model_loaded()
        inputs = self._processor(
            waveform.numpy(),
            sampling_rate=_TARGET_SAMPLE_RATE,
            return_tensors="pt",
            padding=True,
        )
        with torch.no_grad():
            logits = self._model(inputs.input_values.to(_DEVICE)).logits
        log_probs = torch.nn.functional.log_softmax(logits[0], dim=-1)
        vocabulary = list(self._processor.tokenizer.get_vocab().keys())
        return log_probs, vocabulary

    def detect_ipa(self, audio: AudioInput) -> IpaSequence:
        """CTC greedy デコードで音声から IPA 音素列を検出する。"""
        self._ensure_model_loaded()
        waveform = self._load_audio_tensor(audio)
        log_probs, vocabulary = self._run_ctc_inference(waveform)
        # greedy デコード: 各フレームの最大確率インデックスを取得する
        token_indices = torch.argmax(log_probs, dim=-1)
        # CTC の重複と blank（通常インデックス 0）を除去する
        blank_id = self._processor.tokenizer.pad_token_id
        decoded_tokens: list[str] = []
        previous = None
        for idx in token_indices.tolist():
            if idx == blank_id:
                previous = None
                continue
            if idx == previous:
                continue
            previous = idx
            if idx < len(vocabulary):
                token = vocabulary[idx]
                if token not in ("<pad>", "<unk>", "|"):
                    decoded_tokens.append(token)
        phonemes = tuple(PhonemeLabel(t) for t in decoded_tokens if t)
        return IpaSequence(phonemes=phonemes)

    def align(
        self,
        audio: AudioInput,
        reference_ipa: IpaSequence,
    ) -> tuple[tuple[AlignmentBoundary, ...], tuple[PhonemeGopMeasurement, ...]]:
        """torchaudio.functional.forced_align で強制整列し GOP を計算する。

        Args:
            audio: 解析対象の音声入力。
            reference_ipa: g2p で得た期待 IPA 音素列。

        Returns:
            (alignment_boundaries, per_phoneme_gop)
        """
        self._ensure_model_loaded()
        waveform = self._load_audio_tensor(audio)
        log_probs, vocabulary = self._run_ctc_inference(waveform)

        # 参照音素を語彙インデックスに変換する
        vocab_dict = self._processor.tokenizer.get_vocab()
        token_ids = self._convert_phonemes_to_ids(reference_ipa, vocab_dict)

        if not token_ids:
            logger.warning("参照音素のトークン ID が空: 整列をスキップする")
            return (), ()

        # torchaudio.functional.forced_align を呼び出す
        # 入力は (1, T, V) の log_probs テンソルと (1, N) のターゲット
        log_probs_batch = log_probs.unsqueeze(0)
        targets = torch.tensor([token_ids], dtype=torch.int32)
        input_lengths = torch.tensor([log_probs.shape[0]], dtype=torch.int32)
        target_lengths = torch.tensor([len(token_ids)], dtype=torch.int32)

        try:
            aligned_tokens, alignment_scores = torchaudio.functional.forced_align(
                log_probs_batch,
                targets,
                input_lengths,
                target_lengths,
                blank=self._processor.tokenizer.pad_token_id,
            )
        except Exception as e:
            logger.error("forced_align 失敗: %s", e)
            return (), ()

        # フレームを音素ごとにグループ化して境界と GOP を計算する
        boundaries, gop_measurements = self._compute_boundaries_and_gop(
            aligned_tokens[0].tolist(),
            alignment_scores[0],
            log_probs,
            token_ids,
            reference_ipa,
            audio.duration_milliseconds,
            vocabulary,
        )
        return boundaries, gop_measurements

    def _convert_phonemes_to_ids(
        self,
        ipa_sequence: IpaSequence,
        vocab_dict: dict[str, int],
    ) -> list[int]:
        """IpaSequence を語彙インデックスリストに変換する。

        語彙に存在しない音素は unknown として扱い除外する。
        """
        token_ids: list[int] = []
        for phoneme in ipa_sequence.phonemes:
            token_id = vocab_dict.get(phoneme.value)
            if token_id is not None:
                token_ids.append(token_id)
            else:
                # espeak が生成したが wav2vec2 語彙にない音素は個別文字に分解する
                for char in phoneme.value:
                    char_id = vocab_dict.get(char)
                    if char_id is not None:
                        token_ids.append(char_id)
        return token_ids

    def measure_audio_quality(self, audio: AudioInput) -> tuple[float, float]:
        """録音品質を計測する。

        16kHz モノラル waveform の発話区間フレーム RMS から mean dBFS を計算し、
        エネルギーベース VAD で実音声長（秒）を計測する。

        mean_dbfs = 20 * log10(speech_active_rms)。
        発話区間フレームが 0 件（no-speech）の場合は -100.0 dBFS を返す（番兵値）。
        発話区間フレームは audio_energy.compute_speech_active_rms で算出する
        （energy-VAD フレーミング: 320 サンプル / 20ms、ENERGY_SILENCE_RMS_THRESHOLD）。
        全区間 RMS の代わりに発話区間 RMS を使うことで、語間ポーズや末尾無音による
        ラウドネス希釈を除去し、明瞭発話の誤棄却を防ぐ（ADR-015 D1）。
        speechDurationSeconds: compute_speech_duration_seconds_from_energy で算出する。

        Returns:
            (mean_dbfs, speech_duration_seconds)
        """
        waveform = self._load_audio_tensor(audio)
        waveform_numpy = waveform.numpy()

        speech_active_rms = compute_speech_active_rms(waveform_numpy)
        if speech_active_rms < 1e-9:
            mean_dbfs = -100.0
        else:
            mean_dbfs = 20.0 * math.log10(speech_active_rms)

        speech_duration_seconds = compute_speech_duration_seconds_from_energy(waveform_numpy)

        return mean_dbfs, speech_duration_seconds

    def _compute_boundaries_and_gop(
        self,
        aligned_token_sequence: list[int],
        alignment_scores: torch.Tensor,
        log_probs: torch.Tensor,
        token_ids: list[int],
        reference_ipa: IpaSequence,
        audio_duration_milliseconds: int,
        vocabulary: list[str] | None = None,
    ) -> tuple[tuple[AlignmentBoundary, ...], tuple[PhonemeGopMeasurement, ...]]:
        """整列結果から時間境界と GOP を計算する。

        GOP(p) = (1/T) * sum(log P(p|x_t)) （ADR-001）

        vocabulary: top_n_phonemes に使用する語彙リスト。None の場合は n_best 算出をスキップ。
        """
        total_frames = len(aligned_token_sequence)
        frame_duration_ms = (
            audio_duration_milliseconds / total_frames if total_frames > 0 else _FRAME_DURATION_MS
        )

        # token_id -> phoneme のマッピングを構築する
        vocab = self._processor.tokenizer.get_vocab()
        id_to_phoneme: dict[int, str] = {v: k for k, v in vocab.items()}

        boundaries: list[AlignmentBoundary] = []
        gop_measurements: list[PhonemeGopMeasurement] = []

        # aligned_token_sequence を走査して音素ごとのフレーム範囲を特定する
        current_token: int | None = None
        current_start_frame = 0
        frame_indices: list[tuple[int, int, int]] = []  # (token_id, start_frame, end_frame)

        for frame_index, token_id in enumerate(aligned_token_sequence):
            blank_id = self._processor.tokenizer.pad_token_id
            if token_id == blank_id:
                continue
            if token_id != current_token:
                if current_token is not None:
                    frame_indices.append((current_token, current_start_frame, frame_index - 1))
                current_token = token_id
                current_start_frame = frame_index

        if current_token is not None:
            frame_indices.append((current_token, current_start_frame, total_frames - 1))

        # 各音素の境界と GOP を計算する
        for _index, (token_id, start_frame, end_frame) in enumerate(frame_indices):
            phoneme_str = id_to_phoneme.get(token_id, "?")
            if phoneme_str in ("<pad>", "<unk>"):
                continue

            phoneme_label = PhonemeLabel(phoneme_str)
            start_ms = int(start_frame * frame_duration_ms)
            end_ms = int((end_frame + 1) * frame_duration_ms)

            # GOP 計算: 整列フレームの log 事後確率の平均
            frame_count = end_frame - start_frame + 1
            if frame_count > 0:
                gop_frames = log_probs[start_frame : end_frame + 1, token_id]
                gop_value = float(gop_frames.mean().item())
                # n_best: 整列フレーム区間の softmax 平均から上位候補を取得する
                if vocabulary is not None:
                    frame_log_probs = log_probs[start_frame : end_frame + 1, :]
                    avg_log_probs = frame_log_probs.mean(dim=0)
                    # log_probs は log_softmax 値なので exp() で softmax 確率に戻す
                    avg_softmax_probs = torch.exp(avg_log_probs)
                    n_best = top_n_phonemes(avg_softmax_probs, vocabulary, n=3)
                else:
                    n_best = ()
            else:
                gop_value = float("-inf")
                n_best = ()

            boundaries.append(
                AlignmentBoundary(
                    phoneme=phoneme_label,
                    start_milliseconds=start_ms,
                    end_milliseconds=end_ms,
                )
            )
            gop_measurements.append(
                PhonemeGopMeasurement(
                    phoneme=phoneme_label,
                    gop=GopScore(value=gop_value),
                    start_milliseconds=start_ms,
                    end_milliseconds=end_ms,
                    n_best=n_best,
                )
            )

        return tuple(boundaries), tuple(gop_measurements)
