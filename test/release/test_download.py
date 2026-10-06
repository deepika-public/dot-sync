"""Release-gate failures against an isolated HTTP registry; no GitLab credentials."""
import hashlib
import http.server
import io
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import threading
import unittest

ROOT = Path(__file__).resolve().parents[2]
TAG = 'v0.6.0'
OLD_TAG = 'v0.1.0'


def archive_name(tag):
    return f'deepika-sync-{tag}-x86_64-unknown-linux-gnu.tar.gz'


def archive(version, tag=TAG):
    content = io.BytesIO()
    with tarfile.open(fileobj=content, mode='w:gz') as tar:
        script = f'#!/bin/sh\nprintf "deepika-sync {version}\\n"\n'.encode()
        entry = tarfile.TarInfo(archive_name(tag).removesuffix('.tar.gz') + '/deepika-sync')
        entry.mode = 0o755
        entry.size = len(script)
        tar.addfile(entry, io.BytesIO(script))
    return content.getvalue()


class DownloadGate(unittest.TestCase):
    def attempt(self, kind):
        tag = OLD_TAG if kind == 'too-old' else TAG
        package = archive('9.9.9' if kind == 'wrong-version' else tag[1:], tag)
        checksum = f'{hashlib.sha256(package).hexdigest()}  {archive_name(tag)}\n'.encode()
        if kind == 'corrupt':
            package += b'corrupted'
        if kind == 'wrong-checksum-file':
            checksum = f'{hashlib.sha256(b"").hexdigest()}  /dev/null\n'.encode()
        if kind == 'missing-archive-checksum':
            checksum = b''
        if kind == 'duplicate-checksum':
            checksum += checksum
        requests = []

        class Registry(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                requests.append(self.path)
                if self.headers.get('JOB-TOKEN') != 'test-only':
                    self.send_error(403)
                    return
                if kind == 'missing-download':
                    self.send_error(404)
                    return
                self.send_response(200)
                self.end_headers()
                self.wfile.write(checksum if self.path.endswith('SHA256SUMS') else package)

            def log_message(self, *args):
                pass

        with tempfile.TemporaryDirectory(prefix='deepika-sync-download-test-') as tmp:
            work = Path(tmp)
            # Replaces only npm: reaching this executable means the gate admitted the artifact.
            npm = work / 'npm'
            npm.write_text('#!/bin/sh\nprintf "%s\\n" "$*" > "$GATE_MARKER"\n')
            npm.chmod(0o755)
            marker = work / 'integration-invoked'
            server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Registry)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            env = dict(os.environ, DEEPIKA_SYNC_PROJECT_ID='1', DEEPIKA_SYNC_RELEASE_TAG=tag,
                       CI_API_V4_URL=f'http://127.0.0.1:{server.server_port}',
                       CI_JOB_TOKEN='test-only', PATH=f'{work}:{os.environ["PATH"]}',
                       GATE_MARKER=str(marker))
            try:
                result = subprocess.run(['sh', 'scripts/test-release-daemon.sh'], cwd=ROOT,
                                        env=env, text=True, capture_output=True, timeout=10)
                if kind == 'valid':
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertEqual(marker.read_text(), 'run test:integration\n')
                    self.assertEqual(len(requests), 2)
                elif kind == 'too-old':
                    # A genuine but outdated daemon: a warning, not a plugin failure,
                    # and the integration suite must not run against it.
                    self.assertEqual(result.returncode, 78, result.stderr)
                    self.assertIn('older than the 0.6.0', result.stderr)
                    self.assertFalse(marker.exists(), 'Integration ran against an outdated daemon')
                else:
                    self.assertNotIn(result.returncode, (0, 78), result.stdout)
                    self.assertFalse(marker.exists(), 'Integration ran with an invalid artifact')
            finally:
                server.shutdown()
                server.server_close()
                thread.join()

    def test_valid_archive_is_admitted(self):
        self.attempt('valid')

    def test_outdated_daemon_is_reported_as_a_warning(self):
        self.attempt('too-old')

    def test_invalid_artifacts_never_reach_integration(self):
        for kind in ['missing-download', 'corrupt', 'wrong-checksum-file',
                     'missing-archive-checksum', 'duplicate-checksum', 'wrong-version']:
            with self.subTest(kind=kind):
                self.attempt(kind)


if __name__ == '__main__':
    unittest.main()
