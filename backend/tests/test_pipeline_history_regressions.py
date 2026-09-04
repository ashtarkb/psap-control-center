from datetime import datetime, timedelta, timezone

from app.services import fournos_k8s_client as k8s
from app.services import fournos_watcher as watcher


def test_taskrun_condition_specific_terminal_reasons_win_over_false_status():
    assert k8s._phase_from_conditions(
        [{"reason": "TaskRunCancelled", "status": "False"}]
    ) == "Cancelled"
    assert k8s._phase_from_conditions(
        [{"reason": "SkippingNoMatch", "status": "False"}]
    ) == "Skipped"


def test_extract_pipeline_stages_includes_tekton_skipped_tasks(monkeypatch):
    monkeypatch.setattr(
        k8s,
        "get_taskrun",
        lambda _name: {
            "status": {
                "conditions": [{"reason": "Succeeded", "status": "True"}],
                "startTime": "2026-09-03T12:00:00Z",
                "completionTime": "2026-09-03T12:01:00Z",
            }
        },
    )
    pipelinerun = {
        "status": {
            "childReferences": [
                {"name": "prepare-run", "pipelineTaskName": "prepare"}
            ],
            "skippedTasks": [{"name": "optional-check"}],
            "pipelineSpec": {
                "tasks": [{"name": "prepare"}, {"name": "optional-check"}]
            },
        }
    }

    stages = k8s.extract_pipeline_stages(pipelinerun)

    assert {stage["name"]: stage["status"] for stage in stages} == {
        "prepare": "Succeeded",
        "optional-check": "Skipped",
    }


def test_terminal_snapshot_requires_a_complete_pipelinerun(monkeypatch):
    monkeypatch.setattr(k8s, "get_pipelinerun", lambda _name: None)
    monkeypatch.setattr(k8s, "list_pipelineruns_for_job", lambda _name: [])

    assert watcher._compute_terminal_stages(
        "job-1", {"pipeline": "forge-test-only"}, {"pipelineRun": "missing"}
    ) is None


def test_terminal_snapshot_marks_unstarted_definition_tasks_not_run(monkeypatch):
    monkeypatch.setattr(k8s, "get_pipelinerun", lambda _name: {"status": {}})
    monkeypatch.setattr(
        k8s,
        "extract_pipeline_stages",
        lambda _pr: [
            {
                "name": "prepare",
                "displayName": "Prepare",
                "status": "Failed",
                "startTime": "2026-09-03T12:00:00Z",
                "completionTime": "2026-09-03T12:01:00Z",
                "finally": False,
            }
        ],
    )
    monkeypatch.setattr(
        watcher.pipeline_definitions,
        "get_definition_sync",
        lambda _name: {
            "name": "forge-test-only",
            "tasks": ["prepare", "test"],
            "finally": [],
        },
    )

    stages = watcher._compute_terminal_stages(
        "job-1", {"pipeline": "forge-test-only"}, {"pipelineRun": "run-1"}
    )

    assert {stage["name"]: stage["status"] for stage in stages} == {
        "prepare": "Failed",
        "test": "NotRun",
    }


def test_stage_snapshot_retries_are_timed_and_bounded():
    now = datetime.now(timezone.utc)

    assert watcher._stage_snapshot_retry_due(0, None, now) is True
    assert watcher._stage_snapshot_retry_due(1, now, now) is False
    assert watcher._stage_snapshot_retry_due(
        1, now - timedelta(seconds=watcher.STAGE_SNAPSHOT_RETRY_SECONDS + 1), now
    ) is True
    assert watcher._stage_snapshot_retry_due(
        watcher.STAGE_SNAPSHOT_MAX_ATTEMPTS, None, now
    ) is False

    assert watcher._has_usable_stage_snapshot([]) is False
    assert watcher._has_usable_stage_snapshot(
        [{"name": "test", "status": "Pending"}]
    ) is False
    assert watcher._has_usable_stage_snapshot(
        [{"name": "test", "status": "Succeeded"}]
    ) is True
