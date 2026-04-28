import unittest

from python_service.app import (
    THINKING_BUDGET,
    build_thinking_kwargs,
    extract_text,
    resolve_enable_thinking,
    supports_thinking_toggle,
)


class ExtractTextTests(unittest.TestCase):
    def test_extracts_plain_output_text(self):
        self.assertEqual(
            extract_text({"output": {"text": "你好"}}),
            "你好",
        )

    def test_extracts_multimodal_content_list_text_items(self):
        payload = {
            "output": {
                "choices": [
                    {
                        "message": {
                            "content": [
                                {"text": "第一条"},
                                {"text": "第二条"},
                            ]
                        }
                    }
                ]
            }
        }
        self.assertEqual(extract_text(payload), "第一条\n第二条")

    def test_extracts_string_content(self):
        payload = {
            "output": {
                "choices": [
                    {
                        "message": {
                            "content": "直接返回字符串"
                        }
                    }
                ]
            }
        }
        self.assertEqual(extract_text(payload), "直接返回字符串")


class ThinkingModeTests(unittest.TestCase):
    def test_plus_models_support_thinking_toggle(self):
        self.assertTrue(supports_thinking_toggle("qwen3.5-plus"))
        self.assertTrue(supports_thinking_toggle("qwen3.5-plus-2026-02-15"))
        self.assertTrue(supports_thinking_toggle("qwen3.6-plus"))
        self.assertTrue(supports_thinking_toggle("qwen3.6-plus-2026-04-02"))

    def test_other_models_keep_default_thinking_policy(self):
        self.assertFalse(supports_thinking_toggle("qwen3.5-omni-plus"))
        self.assertFalse(supports_thinking_toggle("qwen3.6-flash"))

    def test_resolve_enable_thinking_only_for_supported_models(self):
        self.assertTrue(resolve_enable_thinking("qwen3.5-plus", True))
        self.assertFalse(resolve_enable_thinking("qwen3.6-plus", False))
        self.assertIsNone(resolve_enable_thinking("qwen3.5-omni-plus", True))

    def test_build_thinking_kwargs_with_fixed_budget(self):
        self.assertEqual(
            build_thinking_kwargs("qwen3.5-plus", True),
            {"enable_thinking": True, "thinking_budget": THINKING_BUDGET},
        )
        self.assertEqual(
            build_thinking_kwargs("qwen3.6-plus", False),
            {"enable_thinking": False},
        )
        self.assertEqual(build_thinking_kwargs("qwen3.5-omni-plus", True), {})


if __name__ == "__main__":
    unittest.main()
