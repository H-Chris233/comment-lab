import unittest

from python_service.app import extract_text


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


if __name__ == "__main__":
    unittest.main()
