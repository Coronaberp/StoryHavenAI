import io

import pytest
from PIL import Image

from backend import classify
from backend.repositories import notifications as notification_repo

pytestmark = pytest.mark.asyncio

def _static_png_bytes():
    buf = io.BytesIO()
    Image.new("RGB", (4, 4), color="red").save(buf, format="PNG")
    return buf.getvalue()

def _animated_gif_bytes():
    buf = io.BytesIO()
    frames = [Image.new("RGB", (4, 4), color="red"), Image.new("RGB", (4, 4), color="blue")]
    frames[0].save(buf, format="GIF", save_all=True, append_images=frames[1:], duration=100, loop=0)
    return buf.getvalue()

def _animated_webp_bytes():
    buf = io.BytesIO()
    frames = [Image.new("RGB", (4, 4), color="red"), Image.new("RGB", (4, 4), color="blue")]
    frames[0].save(buf, format="WEBP", save_all=True, append_images=frames[1:], duration=100, loop=0)
    return buf.getvalue()

def _static_webp_bytes():
    buf = io.BytesIO()
    Image.new("RGB", (4, 4), color="green").save(buf, format="WEBP")
    return buf.getvalue()

class TestIsAnimatedImage:
    async def test_none_is_not_animated(self):
        assert classify._is_animated_image(None) is False

    async def test_empty_bytes_is_not_animated(self):
        assert classify._is_animated_image(b"") is False

    async def test_static_png_is_not_animated(self):
        assert classify._is_animated_image(_static_png_bytes()) is False

    async def test_static_webp_is_not_animated(self):
        assert classify._is_animated_image(_static_webp_bytes()) is False

    async def test_animated_gif_is_animated(self):
        assert classify._is_animated_image(_animated_gif_bytes()) is True

    async def test_animated_webp_is_animated(self):
        assert classify._is_animated_image(_animated_webp_bytes()) is True

    async def test_garbage_bytes_is_not_animated(self):
        assert classify._is_animated_image(b"not an image") is False

class TestDataUrlToBytes:
    async def test_valid_data_url_roundtrips(self):
        raw = _static_png_bytes()
        import base64
        data_url = "data:image/png;base64," + base64.b64encode(raw).decode()
        out_bytes, out_mime = classify._data_url_to_bytes(data_url)
        assert out_bytes == raw
        assert out_mime == "image/png"

    async def test_non_data_url_returns_none_none(self):
        assert classify._data_url_to_bytes("https://example.com/x.png") == (None, None)

    async def test_empty_string_returns_none_none(self):
        assert classify._data_url_to_bytes("") == (None, None)

    async def test_malformed_data_url_returns_none_none(self):
        assert classify._data_url_to_bytes("data:image/png;base64,not-valid-base64!!!") == (None, None)

class TestClassifyImageNsfw:
    async def test_animated_gif_bypasses_classifier_and_returns_unconfident(self, monkeypatch):
        async def _boom(*a, **kw):
            raise AssertionError("classifier should never be called for animated GIFs")
        monkeypatch.setattr(classify.llm, "classify_image_explicit", _boom)
        explicit, confidence = await classify.classify_image_nsfw(_animated_gif_bytes(), mime="image/gif")
        assert (explicit, confidence) == (False, 0)

    async def test_animated_webp_bypasses_classifier_and_returns_unconfident(self, monkeypatch):
        async def _boom(*a, **kw):
            raise AssertionError("classifier should never be called for animated WebP")
        monkeypatch.setattr(classify.llm, "classify_image_explicit", _boom)
        explicit, confidence = await classify.classify_image_nsfw(_animated_webp_bytes(), mime="image/webp")
        assert (explicit, confidence) == (False, 0)

    async def test_static_image_calls_classifier_and_returns_its_verdict(self, monkeypatch):
        async def _fake_classify(data_url, model, base_url=None, api_key=None):
            assert data_url.startswith("data:image/png;base64,")
            return True, 92, "yes 92"
        monkeypatch.setattr(classify.llm, "classify_image_explicit", _fake_classify)
        explicit, confidence = await classify.classify_image_nsfw(_static_png_bytes(), mime="image/png")
        assert (explicit, confidence) == (True, 92)

    async def test_static_image_not_flagged_returns_false(self, monkeypatch):
        async def _fake_classify(data_url, model, base_url=None, api_key=None):
            return False, 88, "no 88"
        monkeypatch.setattr(classify.llm, "classify_image_explicit", _fake_classify)
        explicit, confidence = await classify.classify_image_nsfw(_static_png_bytes(), mime="image/png")
        assert (explicit, confidence) == (False, 88)

    async def test_accepts_already_built_data_url_string(self, monkeypatch):
        import base64
        data_url = "data:image/png;base64," + base64.b64encode(_static_png_bytes()).decode()

        async def _fake_classify(data_url_arg, model, base_url=None, api_key=None):
            assert data_url_arg == data_url
            return True, 70, "yes 70"
        monkeypatch.setattr(classify.llm, "classify_image_explicit", _fake_classify)
        explicit, confidence = await classify.classify_image_nsfw(data_url)
        assert (explicit, confidence) == (True, 70)

    async def test_non_data_url_string_returns_unconfident_without_calling_classifier(self, monkeypatch):
        async def _boom(*a, **kw):
            raise AssertionError("classifier should not be called for a non-data URL")
        monkeypatch.setattr(classify.llm, "classify_image_explicit", _boom)
        explicit, confidence = await classify.classify_image_nsfw("https://example.com/x.png")
        assert (explicit, confidence) == (False, 0)

    async def test_empty_string_returns_unconfident(self):
        explicit, confidence = await classify.classify_image_nsfw("")
        assert (explicit, confidence) == (False, 0)

    async def test_classifier_failure_does_not_raise_and_reports_unconfident(self, monkeypatch):
        async def _fail(*a, **kw):
            return False, 0, "<error: boom>"
        monkeypatch.setattr(classify.llm, "classify_image_explicit", _fail)
        explicit, confidence = await classify.classify_image_nsfw(_static_png_bytes(), mime="image/png")
        assert (explicit, confidence) == (False, 0)

class TestClassifyImageBackground:
    async def _drain(self):
        await __import__("asyncio").sleep(0)
        await __import__("asyncio").sleep(0)
        await __import__("asyncio").sleep(0)

    async def test_animated_gif_applies_immediately_and_notifies_admins(self, monkeypatch):
        applied = []
        notified = []

        async def _apply():
            applied.append(True)

        async def _fake_notify(*a, **kw):
            notified.append(a)
        monkeypatch.setattr(notification_repo, "notify_admins", _fake_notify)

        async def _boom(*a, **kw):
            raise AssertionError("classifier should not run for animated GIFs")
        monkeypatch.setattr(classify.llm, "classify_image_explicit", _boom)

        classify.classify_image_background(_animated_gif_bytes(), "image/gif", "user1", False, _apply)
        await self._drain()
        assert applied == [True]
        assert len(notified) == 1

    async def test_static_flagged_image_calls_apply(self, monkeypatch):
        applied = []

        async def _apply():
            applied.append(True)

        async def _fake_classify(data_url, model, base_url=None, api_key=None):
            return True, 95, "yes 95"
        monkeypatch.setattr(classify.llm, "classify_image_explicit", _fake_classify)

        classify.classify_image_background(_static_png_bytes(), "image/png", "user1", False, _apply)
        await self._drain()
        assert applied == [True]

    async def test_static_unflagged_image_does_not_call_apply(self, monkeypatch):
        applied = []

        async def _apply():
            applied.append(True)

        async def _fake_classify(data_url, model, base_url=None, api_key=None):
            return False, 95, "no 95"
        monkeypatch.setattr(classify.llm, "classify_image_explicit", _fake_classify)

        classify.classify_image_background(_static_png_bytes(), "image/png", "user1", False, _apply)
        await self._drain()
        assert applied == []

    async def test_low_confidence_triggers_callback(self, monkeypatch):
        low_confidence_calls = []

        async def _apply():
            pass

        async def _on_low_confidence(explicit, confidence):
            low_confidence_calls.append((explicit, confidence))

        async def _fake_classify(data_url, model, base_url=None, api_key=None):
            return False, 40, "no 40"
        monkeypatch.setattr(classify.llm, "classify_image_explicit", _fake_classify)

        classify.classify_image_background(
            _static_png_bytes(), "image/png", "user1", False, _apply,
            on_low_confidence=_on_low_confidence)
        await self._drain()
        assert low_confidence_calls == [(False, 40)]

    async def test_high_confidence_does_not_trigger_low_confidence_callback(self, monkeypatch):
        low_confidence_calls = []

        async def _apply():
            pass

        async def _on_low_confidence(explicit, confidence):
            low_confidence_calls.append((explicit, confidence))

        async def _fake_classify(data_url, model, base_url=None, api_key=None):
            return True, 95, "yes 95"
        monkeypatch.setattr(classify.llm, "classify_image_explicit", _fake_classify)

        classify.classify_image_background(
            _static_png_bytes(), "image/png", "user1", False, _apply,
            on_low_confidence=_on_low_confidence)
        await self._drain()
        assert low_confidence_calls == []

    async def test_on_done_called_with_explicit_result(self, monkeypatch):
        done_calls = []

        async def _apply():
            pass

        async def _on_done(explicit):
            done_calls.append(explicit)

        async def _fake_classify(data_url, model, base_url=None, api_key=None):
            return True, 95, "yes 95"
        monkeypatch.setattr(classify.llm, "classify_image_explicit", _fake_classify)

        classify.classify_image_background(
            _static_png_bytes(), "image/png", "user1", False, _apply, on_done=_on_done)
        await self._drain()
        assert done_calls == [True]

    async def test_apply_exception_does_not_crash_and_still_calls_on_done(self, monkeypatch):
        done_calls = []

        async def _apply():
            raise RuntimeError("db write failed")

        async def _on_done(explicit):
            done_calls.append(explicit)

        async def _fake_classify(data_url, model, base_url=None, api_key=None):
            return True, 95, "yes 95"
        monkeypatch.setattr(classify.llm, "classify_image_explicit", _fake_classify)

        classify.classify_image_background(
            _static_png_bytes(), "image/png", "user1", False, _apply, on_done=_on_done)
        await self._drain()
        assert done_calls == [True]

    async def test_on_done_exception_is_swallowed(self, monkeypatch):
        async def _apply():
            pass

        async def _on_done(explicit):
            raise RuntimeError("on_done blew up")

        async def _fake_classify(data_url, model, base_url=None, api_key=None):
            return False, 10, "no 10"
        monkeypatch.setattr(classify.llm, "classify_image_explicit", _fake_classify)

        classify.classify_image_background(
            _static_png_bytes(), "image/png", "user1", False, _apply, on_done=_on_done)
        await self._drain()
