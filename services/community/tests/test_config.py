import pytest

from chartviz_community.config import Settings


def test_settings_require_server_side_credentials(tmp_path) -> None:
    settings = Settings.from_env({
        "CHARTVIZ_LLM_BASE_URL": "https://openrouter.ai/api/v1/",
        "CHARTVIZ_LLM_API_KEY": "test-key",
        "CHARTVIZ_LLM_MODEL": "openai/gpt-5.4",
        "CHARTVIZ_LOCAL_API_TOKEN": "local-token-with-32-characters-000",
        "CHARTVIZ_DATA_DIR": str(tmp_path),
    })

    assert settings.llm_base_url == "https://openrouter.ai/api/v1"
    assert settings.data_dir == tmp_path.resolve()


def test_settings_reject_a_short_local_token(tmp_path) -> None:
    with pytest.raises(ValueError, match="CHARTVIZ_LOCAL_API_TOKEN"):
        Settings.from_env({
            "CHARTVIZ_LLM_BASE_URL": "https://example.test/v1",
            "CHARTVIZ_LLM_API_KEY": "test-key",
            "CHARTVIZ_LLM_MODEL": "test-model",
            "CHARTVIZ_LOCAL_API_TOKEN": "short",
            "CHARTVIZ_DATA_DIR": str(tmp_path),
        })
