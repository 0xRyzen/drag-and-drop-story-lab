"""Send immutable, ready episode requests; never upload secrets or generated media."""
import json
import os
from pathlib import Path
import re
import subprocess
import urllib.error
import urllib.parse
import urllib.request


def git(*args: str) -> str:
    return subprocess.check_output(["git", *args], text=True)


def main() -> None:
    env = os.environ
    sha = env["COMMIT_SHA"]
    repo = env["REPOSITORY"]
    if not re.fullmatch(r"[a-f0-9]{40}", sha):
        raise SystemExit("Invalid immutable source commit")
    if env.get("BRANCH") != "main":
        raise SystemExit("Production requests must come from main")
    manual = env.get("EVENT_NAME") == "workflow_dispatch"
    if manual:
        paths = [env.get("EPISODE_PATH", "")]
    else:
        before = env.get("BEFORE_SHA", "")
        if re.fullmatch(r"[a-f0-9]{40}", before) and before != "0" * 40:
            paths = git("diff", "--name-only", "--diff-filter=AM", before, sha, "--", "episodes").splitlines()
        else:
            paths = git("ls-tree", "-r", "--name-only", sha, "--", "episodes").splitlines()
    pattern = r"episodes/season-\d{2}/episode-\d{2}\.md"
    ready = []
    for name in sorted(set(paths)):
        if not re.fullmatch(pattern, name):
            if manual:
                raise SystemExit("Invalid episode path")
            continue
        text = Path(name).read_text(encoding="utf-8")
        if re.match(r"^---\s*\nstatus: ready\s*\n---", text):
            ready.append(name)
        else:
            print(f"Not dispatched: {name} is not marked ready")
    if not ready:
        print("No ready episode descriptions changed. No production requested.")
        return
    # The pilot deliberately has one episode request per commit. This avoids an
    # untested multi-episode queue or parallel credit spending in the first setup.
    if len(ready) != 1:
        raise SystemExit("Pilot accepts one ready episode per push. Mark future episodes draft, or dispatch one episode manually.")
    url, token = env.get("DND_N8N_URL", ""), env.get("DND_WEBHOOK_TOKEN", "")
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or not token:
        raise SystemExit("Setup required: configure DND_N8N_URL and DND_WEBHOOK_TOKEN repository secrets")
    mode = (env.get("REQUESTED_MODE") if manual else env.get("DND_MODE")) or "plan"
    if mode not in {"plan", "render"}:
        raise SystemExit("DND_MODE must be plan or render")
    payload = {"repository": repo, "branch": "main", "commit": sha,
               "path": ready[0], "mode": mode,
               "resume": manual and env.get("RESUME", "").lower() == "true"}
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "Authorization": token})
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            if not 200 <= response.status < 300:
                raise SystemExit(f"n8n request rejected: HTTP {response.status}")
    except urllib.error.HTTPError as exc:
        raise SystemExit(f"n8n request rejected: HTTP {exc.code}; no automatic retry") from None
    except urllib.error.URLError:
        raise SystemExit("n8n receipt is uncertain. Inspect the workflow before retrying; do not assume generation failed.") from None
    print(f"Requested {mode} for {ready[0]} at {sha}. n8n acceptance is not episode completion.")


if __name__ == "__main__":
    main()
