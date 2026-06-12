"""_decode_to_pcm の MIME タイプ分岐テスト。

Done When (A):
- audio/wav, audio/flac 等の soundfile ネイティブ形式はバイトをそのまま返す
- audio/webm はスキップせず ffmpeg 変換パスに入る（returncode != 0 でも RuntimeError を上げる）

注意: soundfile / torch 等の重依存を使うため Docker 環境でのみ完全実行される。
      ローカル環境（依存なし）では skip される。
"""

import struct
import unittest

import pytest

try:
    from python_analyzer.infrastructure.wav2vec2_aligner import Wav2Vec2Aligner

    _DEPS_AVAILABLE = True
except ImportError:
    Wav2Vec2Aligner = None  # type: ignore[assignment,misc]
    _DEPS_AVAILABLE = False

pytestmark = pytest.mark.skipif(not _DEPS_AVAILABLE, reason="soundfile/torch 依存がないため skip")


def _make_minimal_wav(num_samples: int = 16000) -> bytes:
    """最小限の WAV バイト列を生成する（16kHz, 16bit, mono）。"""
    sample_rate = 16000
    bits_per_sample = 16
    num_channels = 1
    byte_rate = sample_rate * num_channels * bits_per_sample // 8
    block_align = num_channels * bits_per_sample // 8
    data_size = num_samples * block_align

    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        36 + data_size,
        b"WAVE",
        b"fmt ",
        16,
        1,  # PCM
        num_channels,
        sample_rate,
        byte_rate,
        block_align,
        bits_per_sample,
        b"data",
        data_size,
    )
    samples = b"\x00\x00" * num_samples
    return header + samples


class TestDecodeTopcm(unittest.TestCase):
    """_decode_to_pcm のユニットテスト。"""

    def setUp(self) -> None:
        self.aligner = Wav2Vec2Aligner()

    def test_wav_mime_returns_content_unchanged(self) -> None:
        """audio/wav は変換せずそのままバイト列を返す。"""
        wav_bytes = _make_minimal_wav()
        result = self.aligner._decode_to_pcm(wav_bytes, "audio/wav")
        assert result == wav_bytes

    def test_wav_with_codec_param_returns_content_unchanged(self) -> None:
        """audio/wav;codecs=pcm も変換せず返す。"""
        wav_bytes = _make_minimal_wav()
        result = self.aligner._decode_to_pcm(wav_bytes, "audio/wav;codecs=pcm")
        assert result == wav_bytes

    def test_x_wav_returns_content_unchanged(self) -> None:
        """audio/x-wav も変換せず返す。"""
        wav_bytes = _make_minimal_wav()
        result = self.aligner._decode_to_pcm(wav_bytes, "audio/x-wav")
        assert result == wav_bytes

    def test_flac_returns_content_unchanged(self) -> None:
        """audio/flac は変換せず返す。"""
        dummy_flac = b"fLaC" + b"\x00" * 100
        result = self.aligner._decode_to_pcm(dummy_flac, "audio/flac")
        assert result == dummy_flac

    def test_webm_with_invalid_bytes_raises_runtime_error(self) -> None:
        """audio/webm はデコードパスに入り、無効なバイト列で RuntimeError を上げる。"""
        invalid_bytes = b"\x00\x01\x02\x03"
        with pytest.raises(RuntimeError, match="ffmpeg デコード失敗"):
            self.aligner._decode_to_pcm(invalid_bytes, "audio/webm")

    def test_ogg_with_invalid_bytes_raises_runtime_error(self) -> None:
        """audio/ogg も ffmpeg パスに入り、無効なバイト列で RuntimeError を上げる。"""
        invalid_bytes = b"\x00\x01\x02\x03"
        with pytest.raises(RuntimeError, match="ffmpeg デコード失敗"):
            self.aligner._decode_to_pcm(invalid_bytes, "audio/ogg")

    def test_webm_with_opus_codec_param_raises_runtime_error(self) -> None:
        """audio/webm;codecs=opus も ffmpeg パスに入る。"""
        invalid_bytes = b"\x00\x01\x02\x03"
        with pytest.raises(RuntimeError, match="ffmpeg デコード失敗"):
            self.aligner._decode_to_pcm(invalid_bytes, "audio/webm;codecs=opus")
