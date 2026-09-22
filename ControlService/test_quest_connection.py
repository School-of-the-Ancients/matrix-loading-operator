"""USB recovery and HTTP boundary tests; every ADB call is mocked."""
import json
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import Mock, patch
import urllib.error
import urllib.request

import quest_connection as quest
from server import Handler, Server, State


class FakeAdb:
    def __init__(self):
        self.calls = []
        self.devices = "List of devices attached\nQUEST1 device product:hollywood model:Quest_Pro\n"
        self.usb_serial = "QUEST1"
        self.model = "Quest Pro"
        self.installed = {quest.PACKAGES[0]}
        self.running = {quest.PACKAGES[0]}
        self.config = json.dumps({"url": "http://127.0.0.1:8765", "token": "do-not-disclose"})
        self.rules = {"tcp:8776": "tcp:8776"}
        self.hide_mapping = False
        self.failure = None

    def __call__(self, argv, **kwargs):
        self.calls.append(argv[1:])
        assert kwargs["shell"] is False
        assert 0 < kwargs["timeout"] <= quest.COMMAND_TIMEOUT
        assert kwargs["stderr"] == subprocess.DEVNULL
        if self.failure:
            raise self.failure
        command = argv[1:]
        code = 0
        if command == ["devices", "-l"]:
            output = self.devices
        elif command == ["-d", "get-serialno"]:
            output = self.usb_serial
        else:
            assert command[:2] == ["-s", "QUEST1"]
            command = command[2:]
            if command == ["shell", "getprop", "ro.product.model"]:
                output = self.model
            elif command[:3] == ["shell", "pm", "path"]:
                output = "package:/data/app/base.apk" if command[3] in self.installed else ""
            elif command[:2] == ["shell", "pidof"]:
                output = "3456" if command[2] in self.running else ""
                code = 0 if output else 1
            elif command[:3] == ["shell", "ls", "-1a"]:
                output = ".\n..\n" + ("control.json" if self.config is not None else "")
            elif command[:4] == ["shell", "head", "-c", "8193"]:
                output = self.config
            elif command == ["reverse", "--list"]:
                output = "\n".join(f"UsbFfs {left} {right}" for left, right in self.rules.items()
                                   if not self.hide_mapping or left != "tcp:8765")
            elif len(command) == 3 and command[0] == "reverse":
                self.rules[command[1]] = command[2]
                output = ""
            else:
                raise AssertionError(f"Unexpected ADB command: {command}")
        return subprocess.CompletedProcess(argv, code, output)


class ReconnectTests(unittest.TestCase):
    def setUp(self):
        self.adb = FakeAdb()
        self.connection = quest.QuestConnection()
        self.find_patch = patch.object(quest, "find_adb", return_value="/trusted/adb")
        self.run_patch = patch.object(quest.subprocess, "run", side_effect=self.adb)
        self.find = self.find_patch.start()
        self.run = self.run_patch.start()
        self.addCleanup(self.find_patch.stop)
        self.addCleanup(self.run_patch.stop)

    def reconnect(self, port=8765, online=lambda: False):
        answer = self.connection.reconnect(port, online)
        self.assertNotIn("do-not-disclose", json.dumps(answer))
        return answer

    def assert_no_mapping(self):
        self.assertFalse(any("reverse" in call for call in self.adb.calls))

    def test_online_skips_adb(self):
        self.assertEqual(self.reconnect(online=lambda: True)["status"], "online")
        self.find.assert_not_called()
        self.run.assert_not_called()

    def test_missing_adb_is_actionable(self):
        self.find.return_value = None
        self.assertEqual(self.reconnect()["status"], "needs_attention")
        self.run.assert_not_called()

    def test_device_attention_states_do_not_mutate(self):
        for devices in ("List of devices attached\n", "QUEST1 unauthorized\n", "QUEST1 offline\n",
                        "QUEST1 no permissions\n", "QUEST1 device\nQUEST2 device\n"):
            with self.subTest(devices=devices):
                self.adb.devices = devices
                self.assertEqual(self.reconnect()["status"], "needs_attention")
                self.assert_no_mapping()

    def test_wireless_or_wrong_model_does_not_mutate(self):
        self.adb.usb_serial = ""
        self.assertEqual(self.reconnect()["status"], "needs_attention")
        self.assert_no_mapping()
        self.adb.usb_serial = "QUEST1"
        self.adb.model = "Pixel 10"
        self.assertEqual(self.reconnect()["status"], "needs_attention")
        self.assert_no_mapping()

    def test_supported_models_map_only_current_port_and_verify(self):
        for model in quest.QUEST_MODELS:
            with self.subTest(model=model):
                self.adb.model = model
                self.adb.calls.clear()
                self.assertEqual(self.reconnect()["status"], "forwarded")
                self.assertEqual(self.adb.rules, {"tcp:8776": "tcp:8776", "tcp:8765": "tcp:8765"})
                self.assertEqual(self.adb.calls[-2:], [["-s", "QUEST1", "reverse", "tcp:8765", "tcp:8765"],
                                                     ["-s", "QUEST1", "reverse", "--list"]])

    def test_bound_port_is_used_without_default_override(self):
        self.adb.config = '{"url":"http://localhost:8789/"}'
        self.assertEqual(self.reconnect(8789)["status"], "forwarded")
        self.assertIn("tcp:8789", self.adb.rules)
        self.assertNotIn("tcp:8765", self.adb.rules)

    def test_wrong_port_returns_sanitized_other_operator_without_mutation(self):
        self.adb.config = '{"url":"http://localhost:8789/","token":"do-not-disclose"}'
        self.assertEqual(self.reconnect()["operatorUrl"], "http://127.0.0.1:8789/")
        self.assertEqual(self.reconnect()["status"], "other_service")
        self.assert_no_mapping()

    def test_missing_config_uses_runtime_default(self):
        self.adb.config = None
        self.assertEqual(self.reconnect()["status"], "forwarded")

    def test_config_failures_do_not_mutate_or_expose_url_or_token(self):
        for raw in ("{", "[]", '"text"', "null", " " * 8193 + "{}",
                    '{"url":null}', '{"url":22}', '{"url":"http://example.com:8789"}',
                    '{"url":"https://127.0.0.1:8789"}', '{"url":"http://a:secret@127.0.0.1:8789"}',
                    '{"url":"http://127.0.0.1:8789/?token=secret"}',
                    '{"url":"http://127.0.0.1:8789/#secret"}',
                    '{"url":"http://127.0.0.1:8789/path"}', '{"url":"http://127.0.0.1:99999"}'):
            with self.subTest(raw=raw[:80]):
                self.adb.config = raw
                response = self.reconnect()
                self.assertEqual(response["status"], "needs_attention")
                self.assertNotIn("operatorUrl", response)
                self.assertNotIn("secret", json.dumps(response))
                self.assert_no_mapping()

    def test_app_closed_missing_or_ambiguous(self):
        self.adb.running.clear()
        self.assertEqual(self.reconnect()["status"], "needs_attention")
        self.adb.installed = set(quest.PACKAGES)
        self.assertEqual(self.reconnect()["status"], "needs_attention")
        self.adb.running = set(quest.PACKAGES)
        self.assertEqual(self.reconnect()["status"], "needs_attention")
        self.adb.running.clear()
        self.adb.installed.clear()
        self.assertEqual(self.reconnect()["status"], "needs_attention")
        self.assert_no_mapping()

    def test_running_white_room_uses_only_its_fixed_config_path(self):
        self.adb.installed = set(quest.PACKAGES)
        self.adb.running = {quest.PACKAGES[1]}
        self.assertEqual(self.reconnect()["status"], "forwarded")
        config_reads = [call[-1] for call in self.adb.calls if "head" in call]
        self.assertEqual(config_reads, ["/sdcard/Android/data/com.matt.matrixoperator.whiteroom/files/control.json"])

    def test_verification_failure_is_not_success(self):
        self.adb.hide_mapping = True
        self.assertEqual(self.reconnect()["status"], "error")

    def test_new_runtime_exchange_can_confirm_online_after_mapping(self):
        self.assertEqual(self.reconnect(online=lambda: "tcp:8765" in self.adb.rules)["status"], "online")

    def test_process_errors_are_sanitized_and_release_lock(self):
        for failure in (OSError("secret"), subprocess.TimeoutExpired("secret", 3, output="secret")):
            self.adb.failure = failure
            answer = self.reconnect()
            self.assertEqual(answer["status"], "error")
            self.assertNotIn("secret", json.dumps(answer))
            self.assertFalse(self.connection.lock.locked())
        self.adb.failure = None
        self.run.side_effect = None
        self.run.return_value = subprocess.CompletedProcess(["adb"], 2, "secret")
        answer = self.reconnect()
        self.assertEqual(answer["status"], "error")
        self.assertNotIn("secret", json.dumps(answer))

    def test_concurrent_attempt_returns_without_adb(self):
        self.connection.lock.acquire()
        self.assertEqual(self.reconnect()["status"], "needs_attention")
        self.run.assert_not_called()
        self.connection.lock.release()


class ReconnectHttpTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.state = State(self.directory.name)
        self.server = Server(("127.0.0.1", 0), self.state)
        self.server.quest_connection.reconnect = Mock(return_value=quest.result("forwarded", "Waiting for app"))
        self.worker = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.worker.start()
        self.base = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.worker.join()
        self.directory.cleanup()

    def request(self, body=None, headers=None, path="/api/runtime/reconnect"):
        request = urllib.request.Request(self.base + path, data=json.dumps({} if body is None else body).encode(),
                                         headers={"Content-Type": "application/json", **(headers or {})})
        try:
            response = urllib.request.urlopen(request, timeout=3)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, json.load(response)

    def test_empty_body_uses_actual_server_port(self):
        code, body = self.request()
        self.assertEqual((code, body["status"]), (200, "forwarded"))
        self.server.quest_connection.reconnect.assert_called_once_with(self.server.server_port, self.state.online)

    def test_browser_cannot_select_device_command_or_url(self):
        for body in ({"port": 8789}, {"serial": "any"}, {"command": "anything"},
                     {"url": "http://evil.test"}, {"path": "control.json"}, [], None):
            if body is None:
                continue
            self.assertEqual(self.request(body)[0], 400)
        self.assertEqual(self.request(path="/api/runtime/reconnect?port=8789")[0], 400)
        self.server.quest_connection.reconnect.assert_not_called()

    def test_auth_origin_and_host_guards(self):
        self.server.token = "test-token"
        self.assertEqual(self.request()[0], 401)
        auth = {"Authorization": "Bearer test-token"}
        self.assertEqual(self.request(headers={**auth, "Origin": "http://evil.test"})[0], 403)
        self.assertEqual(self.request(headers={**auth, "Host": "evil.test"})[0], 403)
        self.server.quest_connection.reconnect.assert_not_called()
        self.assertEqual(self.request(headers={**auth, "Origin": self.base})[0], 200)

    def test_remote_peer_cannot_run_adb_even_with_auth(self):
        original = Handler.setup

        def remote_setup(handler):
            original(handler)
            handler.client_address = ("192.0.2.1", handler.client_address[1])

        self.server.token = "test-token"
        with patch.object(Handler, "setup", remote_setup):
            self.assertEqual(self.request(headers={"Authorization": "Bearer test-token"})[0], 403)
        self.server.quest_connection.reconnect.assert_not_called()

    def test_adb_work_does_not_hold_state_lock(self):
        entered, finish = threading.Event(), threading.Event()

        def delayed_reconnect(*_):
            entered.set()
            finish.wait(2)
            return quest.result("forwarded", "Waiting for app")

        self.server.quest_connection.reconnect.side_effect = delayed_reconnect
        request_worker = threading.Thread(target=self.request)
        request_worker.start()
        try:
            self.assertTrue(entered.wait(1))
            with urllib.request.urlopen(self.base + "/api/state", timeout=1) as response:
                self.assertEqual(response.status, 200)
            self.assertTrue(self.state.lock.acquire(timeout=0.5))
            self.state.lock.release()
        finally:
            finish.set()
            request_worker.join(3)


class UrlTests(unittest.TestCase):
    def test_only_plain_loopback_http_base_urls(self):
        self.assertEqual(quest.usb_port("http://127.0.0.1:8789"), 8789)
        self.assertEqual(quest.usb_port("http://localhost:8765/"), 8765)
        for value in ("http://127.0.0.1:0", "http://127.0.0.1:1\\@evil.test", "http://127.0.0.1\n:8765",
                      "http://127.0.0.1:8765?", "http://127.0.0.1:8765#"):
            with self.subTest(value=value):
                self.assertIsNone(quest.usb_port(value))


if __name__ == "__main__":
    unittest.main()
