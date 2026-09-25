"""Voice transport/context regression tests using mocked STT and planning.

No optional speech dependency, model inference, live Codex call, or headset is
used here. Synthetic WAV audio exercises validation, not recognition accuracy.
"""
import base64
import copy
import io
import json
import os
from pathlib import Path
import struct
import subprocess
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request
import wave

import speech
import tts
import server
import test_server as fixtures


def wav_bytes(*, frames=8000, channels=1, rate=16000, width=2, amplitude=1200):
    data = io.BytesIO()
    with wave.open(data, "wb") as audio:
        audio.setnchannels(channels)
        audio.setsampwidth(width)
        audio.setframerate(rate)
        sample = struct.pack("<h", amplitude) if width == 2 else bytes([128])
        audio.writeframes(sample * frames * channels)
    return data.getvalue()


def selected_snapshot():
    value = copy.deepcopy(fixtures.SNAPSHOT)
    value["scene"]["objects"] = [
        {"objectId": "chair-one", "assetId": "cube", "anchorId": "floor", "transform": copy.deepcopy(fixtures.TRANSFORM)},
        {"objectId": "chair-two", "assetId": "cube", "anchorId": "floor", "transform": copy.deepcopy(fixtures.TRANSFORM)},
    ]
    value["selection"] = {"objectId": "chair-one", "anchorId": "floor", "position": {"x": 1, "y": 0, "z": 2}}
    value["viewer"] = {"frames": [{"anchorId": "floor", "position": {"x": 0, "y": 1.7, "z": 0},
                                  "forward": {"x": 0, "y": 0, "z": 1}}]}
    return value


def proposal():
    pose = copy.deepcopy(fixtures.TRANSFORM)
    pose["scale"] = {"x": 2, "y": 2, "z": 2}
    return {"commands": [{"op": "set_transform", "objectId": "chair-one", "transform": pose}],
            "summary": "Resize the selected chair.", "assumptions": [],
            "requiresApply": True, "status": "ready", "mode": "codex-cli"}


class AudioValidationTests(unittest.TestCase):
    def test_valid_bounded_pcm_and_base64_round_trip(self):
        for frames in (4000, 8000, 240000):
            data = wav_bytes(frames=frames)
            self.assertEqual(speech.decode_audio(base64.b64encode(data).decode()), data)

    def test_rejects_silence_before_model_is_used(self):
        with self.assertRaisesRegex(speech.SpeechError, "No speech heard"):
            speech.decode_audio(base64.b64encode(wav_bytes(amplitude=0)).decode())

    def test_rejects_bad_base64_types_and_oversize(self):
        for data in (None, 10, [], "", "not base64!", "A" * (4 * ((speech.MAX_AUDIO_BYTES + 2) // 3) + 4)):
            with self.subTest(data_type=type(data).__name__):
                with self.assertRaises(speech.SpeechError) as error:
                    speech.decode_audio(data)
                self.assertEqual(error.exception.status, 400)

    def test_rejects_bad_wav_format_duration_and_truncation(self):
        cases = [b"bad header" * 20, wav_bytes(channels=2), wav_bytes(rate=48000), wav_bytes(width=1),
                 wav_bytes(frames=3999), wav_bytes(frames=240001), wav_bytes()[:-20]]
        for data in cases:
            with self.subTest(length=len(data)):
                with self.assertRaises(speech.SpeechError) as error:
                    speech.validate_audio(data)
                self.assertEqual(error.exception.status, 400)

    def test_missing_install_is_actionable_and_contains_no_paths(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {
                "SANDBOX_SPEECH_PYTHON": str(Path(directory, "missing.exe")),
                "SANDBOX_SPEECH_MODEL": str(Path(directory, "missing-model"))}):
            status = speech.public_status()
        self.assertFalse(status["configured"])
        self.assertIn("Setup-LocalSpeech.ps1", status["error"])
        self.assertNotIn(directory, status["error"])

    def test_transcriber_subprocess_is_offline_bounded_and_strips_credentials(self):
        completed = subprocess.CompletedProcess([], 0, b'{"transcript":"  make this   larger  "}', b"")
        environment = {"OPENAI_API_KEY": "unit-test-secret", "HF_TOKEN": "unit-test-secret", "SANDBOX_TOKEN": "unit-test-secret"}
        with patch.dict(os.environ, environment, clear=True), patch.object(speech, "configuration", return_value=(Path("python.exe"), Path("model"))), \
                patch.object(speech.subprocess, "run", return_value=completed) as run:
            self.assertEqual(speech.transcribe(wav_bytes()), "make this larger")
        options = run.call_args.kwargs
        self.assertEqual(options["timeout"], 90)
        self.assertEqual(options["env"]["HF_HUB_OFFLINE"], "1")
        self.assertEqual(options["env"]["HF_HUB_DISABLE_IMPLICIT_TOKEN"], "1")
        self.assertFalse(set(environment) & set(options["env"]))
        self.assertIsInstance(options["input"], bytes)

    def test_subprocess_errors_and_invalid_transcripts_are_not_commands(self):
        outcomes = [(subprocess.TimeoutExpired("mock", 90), 504), (OSError("mock"), 503),
                    (subprocess.CompletedProcess([], 1, b"", b"private detail"), 503),
                    (subprocess.CompletedProcess([], 0, b"not-json", b""), 502),
                    (subprocess.CompletedProcess([], 0, b'{"transcript":42}', b""), 502),
                    (subprocess.CompletedProcess([], 0, b'{"transcript":"   "}', b""), 422)]
        for outcome, status in outcomes:
            with self.subTest(status=status, outcome=type(outcome).__name__):
                behavior = {"side_effect": outcome} if isinstance(outcome, Exception) else {"return_value": outcome}
                with patch.object(speech, "configuration", return_value=(Path("python.exe"), Path("model"))), \
                        patch.object(speech.subprocess, "run", **behavior):
                    with self.assertRaises(speech.SpeechError) as error:
                        speech.transcribe(wav_bytes())
                self.assertEqual(error.exception.status, status)
                self.assertNotIn("private detail", str(error.exception))


class VoiceJobTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.now = [100.0]
        self.state = server.State(self.directory.name, clock=lambda: self.now[0])
        self.snapshot = selected_snapshot()
        self.state.exchange({"clientId": "quest-a", "snapshot": self.snapshot, "results": []})
        self.body = {"clientId": "quest-a", "snapshot": copy.deepcopy(self.snapshot),
                     "audioBase64": base64.b64encode(wav_bytes()).decode()}
        self.gates = []
        self.patches = [patch.dict(os.environ, {}, clear=True),
                        patch.object(speech, "configuration", return_value=(Path("python.exe"), Path("model"))),
                        patch.object(server.Planner, "public_status", return_value={"configured": True, "mode": "codex-cli"}),
                        patch.object(speech, "transcribe", return_value="make this twice as big"),
                        patch.object(server.Planner, "plan", return_value=proposal())]
        self.env, self.config, self.provider, self.transcribe, self.planner = [item.start() for item in self.patches]

    def tearDown(self):
        for event in self.gates:
            event.set()
        self.wait_idle()
        for item in reversed(self.patches):
            item.stop()
        self.directory.cleanup()

    def wait_idle(self):
        deadline = time.monotonic() + 3
        while self.state.voice_worker.locked() and time.monotonic() < deadline:
            time.sleep(0.005)
        self.assertFalse(self.state.voice_worker.locked(), "Voice test worker did not finish")

    def block(self, mocked, value):
        entered, release = threading.Event(), threading.Event()
        self.gates.append(release)
        def blocked(*args, **kwargs):
            entered.set()
            if not release.wait(3):
                raise RuntimeError("Test worker gate timed out")
            return value
        mocked.side_effect = blocked
        return entered, release

    def begin(self):
        return server.start_voice(self.state, self.body)["jobId"]

    def exchange(self, snapshot):
        self.state.exchange({"clientId": "quest-a", "snapshot": snapshot, "results": []})

    def test_captured_selection_and_viewer_survive_head_motion_and_input_mutation(self):
        entered, release = self.block(self.transcribe, "make this twice as big")
        job_id = self.begin()
        self.assertTrue(entered.wait(1))
        self.body["snapshot"]["selection"]["objectId"] = "chair-two"
        moving = copy.deepcopy(self.snapshot)
        moving["viewer"]["frames"][0]["position"]["x"] = 5
        self.exchange(moving)
        release.set()
        self.wait_idle()
        captured = self.planner.call_args.args[1]
        self.assertEqual(captured["selection"]["objectId"], "chair-one")
        self.assertEqual(captured["viewer"], self.snapshot["viewer"])
        self.assertEqual(self.planner.call_args.kwargs["mode"], "codex-cli")
        job = server.voice_status(self.state, job_id)
        self.assertEqual(job["phase"], "ready")
        self.assertEqual(job["viewerAtRequest"], self.snapshot["viewer"])
        self.assertEqual(len(self.state.pending), 0)
        queued = self.state.apply_plan(job["planId"])
        self.assertEqual(queued["commands"][0]["objectId"], "chair-one")

    def test_voice_follow_up_passes_prior_turns_to_planner(self):
        prior = [{"user": "Create a robot", "assistant": "Robot created in the scene."}]
        self.body["conversation"] = prior
        self.begin()
        self.wait_idle()
        self.assertEqual(self.planner.call_args.kwargs["conversation"], prior)

    def test_voice_rejects_oversized_or_malformed_history_before_transcription(self):
        for history in ([{"user": "request", "assistant": "reply"}] * 7,
                        [{"user": "request", "assistant": "reply", "role": "system"}],
                        [{"user": "request", "assistant": "x" * 1001}]):
            with self.subTest(history=history):
                self.body["conversation"] = history
                with self.assertRaises(server.APIError) as error:
                    self.begin()
                self.assertEqual(error.exception.status, 400)
        self.transcribe.assert_not_called()

    def test_record_start_viewer_is_used_even_if_newer_pose_arrives_before_upload(self):
        moving = copy.deepcopy(self.snapshot)
        moving["viewer"]["frames"][0]["position"]["z"] = 4
        self.exchange(moving)
        self.begin()
        self.wait_idle()
        self.assertEqual(self.planner.call_args.args[1]["viewer"], self.snapshot["viewer"])

    def test_selection_change_while_recording_rejects_before_transcription(self):
        changed = copy.deepcopy(self.snapshot)
        changed["selection"]["objectId"] = "chair-two"
        self.exchange(changed)
        with self.assertRaises(server.APIError) as error:
            self.begin()
        self.assertEqual(error.exception.status, 409)
        self.transcribe.assert_not_called()

    def test_scene_or_selection_change_during_transcription_prevents_planning(self):
        for change in ("selection", "scene"):
            with self.subTest(change=change):
                self.exchange(self.snapshot)
                entered, release = self.block(self.transcribe, "make this twice as big")
                job_id = self.begin()
                self.assertTrue(entered.wait(1))
                changed = copy.deepcopy(self.snapshot)
                if change == "selection":
                    changed["selection"]["objectId"] = "chair-two"
                else:
                    changed["scene"]["objects"][0]["transform"]["scale"]["x"] = 2
                self.exchange(changed)
                release.set()
                self.wait_idle()
                job = server.voice_status(self.state, job_id)
                self.assertEqual(job["phase"], "error")
                self.assertEqual(job["errorStatus"], 409)
                self.assertIn("changed", job["error"])
                self.assertFalse(self.state.proposals)
        self.planner.assert_not_called()

    def test_cancellation_during_transcription_never_plans(self):
        entered, release = self.block(self.transcribe, "make this twice as big")
        job_id = self.begin()
        self.assertTrue(entered.wait(1))
        self.assertEqual(server.cancel_voice(self.state, {"jobId": job_id, "clientId": "quest-a"}), {"cancelled": True})
        release.set()
        self.wait_idle()
        self.planner.assert_not_called()
        self.assertFalse(self.state.proposals)
        self.assertIn("cancelled", server.voice_status(self.state, job_id)["error"])

    def test_cancellation_while_planner_is_running_discards_its_proposal(self):
        entered, release = self.block(self.planner, proposal())
        job_id = self.begin()
        self.assertTrue(entered.wait(1))
        self.assertEqual(server.voice_status(self.state, job_id)["phase"], "planning")
        server.cancel_voice(self.state, {"jobId": job_id, "clientId": "quest-a"})
        release.set()
        self.wait_idle()
        self.assertFalse(self.state.proposals)
        self.assertFalse(self.state.pending)
        self.assertFalse(server.voice_status(self.state, job_id)["requiresApply"])

    def test_scene_change_during_planning_discards_result(self):
        entered, release = self.block(self.planner, proposal())
        job_id = self.begin()
        self.assertTrue(entered.wait(1))
        changed = copy.deepcopy(self.snapshot)
        changed["scene"]["objects"].pop()
        self.exchange(changed)
        release.set()
        self.wait_idle()
        self.assertEqual(server.voice_status(self.state, job_id)["phase"], "error")
        self.assertFalse(self.state.proposals)

    def test_only_one_transcription_worker_and_release_after_failure(self):
        entered, release = self.block(self.transcribe, "make this twice as big")
        self.begin()
        self.assertTrue(entered.wait(1))
        with self.assertRaises(server.APIError) as error:
            self.begin()
        self.assertEqual(error.exception.status, 409)
        self.assertEqual(self.transcribe.call_count, 1)
        release.set()
        self.wait_idle()
        self.transcribe.side_effect = speech.SpeechError("No speech heard.")
        job_id = self.begin()
        self.wait_idle()
        self.assertEqual(server.voice_status(self.state, job_id)["phase"], "error")
        self.assertEqual(self.planner.call_count, 1)

    def test_offline_rules_cannot_masquerade_as_voice_ai(self):
        self.provider.return_value = {"configured": False, "mode": "offline-rules"}
        with self.assertRaises(server.APIError) as error:
            self.begin()
        self.assertEqual(error.exception.status, 503)
        self.transcribe.assert_not_called()
        self.planner.assert_not_called()

    def test_worker_start_failure_releases_lock_and_removes_unstarted_job(self):
        with patch.object(server.threading.Thread, "start", side_effect=RuntimeError("test exhaustion")):
            with self.assertRaises(server.APIError) as error:
                self.begin()
        self.assertEqual(error.exception.status, 503)
        self.assertFalse(self.state.voice_worker.locked())
        self.assertFalse(self.state.voice_jobs)
        self.transcribe.assert_not_called()

    def test_apply_is_exactly_once_and_voice_poll_cannot_queue_it_again(self):
        job_id = self.begin()
        self.wait_idle()
        job = server.voice_status(self.state, job_id)
        first = self.state.apply_plan(job["planId"])
        with self.assertRaises(server.APIError) as error:
            self.state.apply_plan(job["planId"])
        self.assertEqual(error.exception.status, 409)
        self.assertEqual(len(self.state.pending), len(first["commands"]))
        status = server.voice_status(self.state, job_id)
        self.assertEqual(status["phase"], "finished")
        self.assertFalse(status["requiresApply"])

    def test_ready_proposal_expiry_is_reported_before_application(self):
        job_id = self.begin()
        self.wait_idle()
        self.now[0] += 121
        self.exchange(self.snapshot)
        job = server.voice_status(self.state, job_id)
        self.assertFalse(job["requiresApply"])
        self.assertFalse(self.state.proposals)
        self.assertFalse(self.state.pending)

    def test_disconnection_or_new_client_during_transcription_cannot_edit(self):
        entered, release = self.block(self.transcribe, "make this twice as big")
        job_id = self.begin()
        self.assertTrue(entered.wait(1))
        self.now[0] += server.LEASE_SECONDS + 1
        self.state.exchange({"clientId": "quest-b", "snapshot": self.snapshot, "results": []})
        release.set()
        self.wait_idle()
        self.assertEqual(server.voice_status(self.state, job_id)["phase"], "error")
        self.assertFalse(self.state.proposals)
        self.planner.assert_not_called()

    def test_ready_job_cancel_requires_owning_client_and_removes_plan(self):
        job_id = self.begin()
        self.wait_idle()
        job = server.voice_status(self.state, job_id)
        with self.assertRaises(server.APIError) as error:
            server.cancel_voice(self.state, {"jobId": job_id, "clientId": "other"})
        self.assertEqual(error.exception.status, 409)
        self.assertIn(job["planId"], self.state.proposals)
        server.cancel_voice(self.state, {"jobId": job_id, "clientId": "quest-a"})
        self.assertNotIn(job["planId"], self.state.proposals)

    def test_stale_ready_proposal_is_invalidated_and_not_executed(self):
        job_id = self.begin()
        self.wait_idle()
        changed = copy.deepcopy(self.snapshot)
        changed["selection"]["objectId"] = "chair-two"
        self.exchange(changed)
        job = server.voice_status(self.state, job_id)
        self.assertEqual(job["phase"], "error")
        self.assertFalse(job["requiresApply"])
        self.assertFalse(self.state.proposals)
        self.assertFalse(self.state.pending)

    def test_voice_jobs_and_unapplied_proposals_have_bounded_retention(self):
        identifiers = []
        for _ in range(6):
            identifiers.append(self.begin())
            self.wait_idle()
        self.assertEqual(len(self.state.voice_jobs), 4)
        self.assertEqual(len(self.state.proposals), 4)
        self.assertNotIn(identifiers[0], self.state.voice_jobs)

    def test_voice_captures_model_preferences_before_transcription(self):
        self.state.codex_preferences = {"model": "mock-model", "reasoningEffort": "high"}
        entered, release = self.block(self.transcribe, "make this twice as big")
        self.begin()
        self.assertTrue(entered.wait(1))
        self.state.codex_preferences["reasoningEffort"] = "low"
        release.set()
        self.wait_idle()
        self.assertEqual(self.planner.call_args.kwargs["codex"], {"model": "mock-model", "reasoningEffort": "high"})

    def test_clarification_is_visible_without_an_executable_plan(self):
        self.planner.return_value = {"commands": [], "requiresApply": False, "status": "needs_clarification", "summary": "Select an object."}
        job_id = self.begin()
        self.wait_idle()
        job = server.voice_status(self.state, job_id)
        self.assertEqual(job["phase"], "needs_clarification")
        self.assertFalse(job["requiresApply"])
        self.assertFalse(self.state.proposals)


class VoiceHttpTests(unittest.TestCase):
    """Reuse HTTP request logic, not its TestCase subclass or test methods."""
    request = fixtures.ServiceTests.request

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.state = server.State(self.directory.name)
        self.server = server.Server(("127.0.0.1", 0), self.state)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_port}"
        self.http = urllib.request.build_opener()
        self.env = patch.dict(os.environ, {}, clear=True)
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.directory.cleanup()

    def test_audio_validation_returns_json_error_without_optional_dependencies(self):
        status, result = self.request("/api/voice", {"clientId": "quest-a", "snapshot": selected_snapshot(), "audioBase64": "invalid!"})
        self.assertEqual(status, 400)
        self.assertIn("audio", result["error"].lower())

    def test_pc_spoken_reply_returns_wav_with_existing_request_guards(self):
        body = {"text": "The robot is ready."}
        self.assertEqual(self.request("/api/voice/speak", {"text": ""})[0], 400)
        self.assertEqual(self.request("/api/voice/speak", body, headers={"Origin": "https://other.invalid"})[0], 403)
        self.server.token = "unit-test-token-with-enough-length"
        self.assertEqual(self.request("/api/voice/speak", body)[0], 401)
        with patch("tts.synthesize", return_value=b"RIFFxxxxWAVE") as synthesize:
            request = urllib.request.Request(self.base + "/api/voice/speak", data=json.dumps(body).encode(),
                                             headers={"Content-Type": "application/json",
                                                      "Authorization": "Bearer " + self.server.token})
            with self.http.open(request, timeout=3) as response:
                self.assertEqual(response.headers.get_content_type(), "audio/wav")
                self.assertEqual(response.read(), b"RIFFxxxxWAVE")
            synthesize.assert_called_once_with(body["text"])

    def test_missing_voice_job_and_cancel_are_controlled_errors(self):
        self.assertEqual(self.request("/api/voice/missing")[0], 404)
        self.assertEqual(self.request("/api/voice/cancel", {"jobId": "missing", "clientId": "quest-a"})[0], 404)

    def test_preferences_reject_malformed_values_without_mutating_state(self):
        executable = Path(self.directory.name, "fake-codex.exe")
        executable.write_bytes(b"MZ-test-metadata-only-never-executed")
        config = server.CodexConfig(str(executable))
        for body in ({}, {"codex": [], "extra": True}, {"codex": []}, {"codex": {"reasoningEffort": []}},
                     {"codex": {"model": ""}}, {"codex": {"unknown": "field"}}):
            with self.subTest(body=body), patch.object(server.CodexConfig, "from_environment", return_value=config):
                status, result = self.request("/api/planner_preferences", body)
                self.assertEqual(status, 400)
                self.assertIn("error", result)
                self.assertIsNone(self.state.codex_preferences)

    def test_valid_preferences_are_retained_and_can_reset_to_service_default(self):
        executable = Path(self.directory.name, "fake-codex.exe")
        executable.write_bytes(b"MZ-test-metadata-only-never-executed")
        config = server.CodexConfig(str(executable))
        options = {"models": [{"id": "mock-model", "reasoningEfforts": ["high"]}]}
        chosen = {"model": "mock-model", "reasoningEffort": "high"}
        with patch.object(server.CodexConfig, "from_environment", return_value=config), \
                patch("codex_provider.codex_options", return_value=options):
            self.assertEqual(self.request("/api/planner_preferences", {"codex": chosen}), (200, {"codex": chosen}))
            self.assertEqual(self.state.codex_preferences, chosen)
            self.assertEqual(self.request("/api/planner_preferences", {"codex": None}), (200, {"codex": None}))
        self.assertIsNone(self.state.codex_preferences)

    def test_nondefault_preferences_without_codex_configuration_return_controlled_error(self):
        # Metadata cannot turn absent provider access into a configured provider.
        options = {"models": [{"id": "mock-model", "reasoningEfforts": ["high"]}]}
        with patch("codex_provider.codex_options", return_value=options):
            status, result = self.request("/api/planner_preferences", {"codex": {"model": "mock-model", "reasoningEffort": "high"}})
        self.assertIn(status, (422, 503))
        self.assertIn("error", result)
        self.assertIsNone(self.state.codex_preferences)

    def test_voice_mutation_retains_cross_origin_and_authentication_guards(self):
        body = {"clientId": "quest-a", "snapshot": selected_snapshot(), "audioBase64": "invalid!"}
        self.assertEqual(self.request("/api/voice", body, headers={"Origin": "https://other.invalid"})[0], 403)
        self.server.token = "unit-test-token-with-enough-length"
        self.assertEqual(self.request("/api/voice", body)[0], 401)


if __name__ == "__main__":
    unittest.main()
