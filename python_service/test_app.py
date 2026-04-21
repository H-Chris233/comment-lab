import unittest

from python_service.app import extract_text, should_disable_thinking


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
    def test_plus_models_disable_thinking(self):
        self.assertTrue(should_disable_thinking("qwen3.5-plus"))
        self.assertTrue(should_disable_thinking("qwen3.5-plus-2026-02-15"))
        self.assertTrue(should_disable_thinking("qwen3.6-plus"))
        self.assertTrue(should_disable_thinking("qwen3.6-plus-2026-04-02"))

    def test_other_models_keep_default_thinking_policy(self):
        self.assertFalse(should_disable_thinking("qwen3.5-omni-plus"))
        self.assertFalse(should_disable_thinking("qwen3.6-flash"))


if __name__ == "__main__":
    unittest.main()
