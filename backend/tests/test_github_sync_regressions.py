import asyncio

import pytest

from app.services import github_sync_service
from app.services import pipeline_definitions
from app.services import project_ui_schema


def test_concurrent_refresh_callers_receive_complete_status(monkeypatch):
    async def scenario():
        started = asyncio.Event()
        release = asyncio.Event()
        calls = 0

        async def fake_refresh():
            nonlocal calls
            calls += 1
            started.set()
            await release.wait()
            return {"project_count": 4}

        monkeypatch.setattr(github_sync_service, "_do_refresh", fake_refresh)
        monkeypatch.setattr(github_sync_service, "_inflight", None)
        monkeypatch.setattr(
            github_sync_service,
            "_status",
            {
                "in_progress": False,
                "last_synced_at": None,
                "last_attempted_at": None,
                "last_error": None,
                "project_count": 0,
            },
        )

        first = asyncio.create_task(github_sync_service.refresh_now())
        await started.wait()
        second = asyncio.create_task(github_sync_service.refresh_now())
        release.set()
        first_status, second_status = await asyncio.gather(first, second)

        assert calls == 1
        assert first_status == second_status
        assert first_status["project_count"] == 4
        assert first_status["last_synced_at"] is not None
        assert first_status["in_progress"] is False

    asyncio.run(scenario())


def test_pipeline_refresh_failure_preserves_cached_definitions(monkeypatch):
    previous = {"forge-full": {"name": "forge-full"}}
    monkeypatch.setattr(pipeline_definitions, "_cache", previous)
    monkeypatch.setattr(pipeline_definitions, "_refresh_inflight", None)

    def fail_refresh():
        raise RuntimeError("GitHub unavailable")

    monkeypatch.setattr(
        pipeline_definitions, "_load_all_strict_sync", fail_refresh
    )

    with pytest.raises(RuntimeError, match="GitHub unavailable"):
        asyncio.run(pipeline_definitions.refresh_all())

    assert pipeline_definitions._cache is previous


def test_ui_schema_refresh_failure_preserves_cached_schema(monkeypatch):
    previous = object()
    monkeypatch.setattr(project_ui_schema, "_cache", {"demo": previous})
    monkeypatch.setattr(project_ui_schema, "_inflight", {})

    def fail_refresh(project, strict=False):
        raise RuntimeError("GitHub unavailable")

    monkeypatch.setattr(project_ui_schema, "fetch_schema", fail_refresh)

    with pytest.raises(RuntimeError, match="GitHub unavailable"):
        asyncio.run(project_ui_schema.refresh_schema("demo"))

    assert project_ui_schema._cache["demo"] is previous
