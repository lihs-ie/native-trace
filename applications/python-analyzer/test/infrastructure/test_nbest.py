"""top_n_phonemes 純関数のユニットテスト。

torch 依存があるため skipif で分離する。
"""

import pytest

try:
    import torch

    from python_analyzer.infrastructure.wav2vec2_aligner import top_n_phonemes

    _DEPS_AVAILABLE = True
except ImportError:
    _DEPS_AVAILABLE = False

pytestmark = pytest.mark.skipif(not _DEPS_AVAILABLE, reason="torch が利用不可のため skip")


class TestTopNPhonemes:
    """top_n_phonemes 純関数のテスト。"""

    def test_returns_top_3_candidates(self) -> None:
        """上位 3 件の候補を返すこと。"""
        vocab = ["<pad>", "a", "b", "c", "d"]
        # c(idx=3)=0.5, b(idx=2)=0.3, d(idx=4)=0.15, a(idx=1)=0.05
        probs = torch.tensor([0.0, 0.05, 0.3, 0.5, 0.15])
        result = top_n_phonemes(probs, vocab, n=3)
        assert len(result) == 3
        assert result[0].phoneme == "c"
        assert abs(result[0].confidence - 0.5) < 1e-5
        assert result[1].phoneme == "b"
        assert result[2].phoneme == "d"

    def test_excludes_special_tokens(self) -> None:
        """<pad>/<unk>/| の特殊トークンは除外されること。"""
        vocab = ["<pad>", "<unk>", "|", "a", "b"]
        probs = torch.tensor([0.5, 0.4, 0.3, 0.15, 0.1])
        result = top_n_phonemes(probs, vocab, n=3)
        # 特殊トークンを除いた候補は "a", "b" の 2 件のみ
        assert len(result) == 2
        assert result[0].phoneme == "a"
        assert result[1].phoneme == "b"

    def test_candidates_are_in_descending_order(self) -> None:
        """候補が確率降順で並んでいること。"""
        vocab = ["x", "y", "z", "w"]
        probs = torch.tensor([0.1, 0.4, 0.3, 0.2])
        result = top_n_phonemes(probs, vocab, n=4)
        confidences = [c.confidence for c in result]
        assert confidences == sorted(confidences, reverse=True)

    def test_returns_empty_for_all_special_tokens(self) -> None:
        """全て特殊トークンの場合は空タプルを返すこと。"""
        vocab = ["<pad>", "<unk>", "|"]
        probs = torch.tensor([0.5, 0.3, 0.2])
        result = top_n_phonemes(probs, vocab, n=3)
        assert len(result) == 0

    def test_confidence_sums_not_required_to_be_one(self) -> None:
        """confidence は softmax 確率 (0-1 の実数) であること。"""
        vocab = ["a", "b", "c"]
        probs = torch.tensor([0.6, 0.3, 0.1])
        result = top_n_phonemes(probs, vocab, n=3)
        for candidate in result:
            assert 0.0 <= candidate.confidence <= 1.0
