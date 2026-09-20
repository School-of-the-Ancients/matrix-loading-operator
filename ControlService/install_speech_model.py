"""Explicit setup-time download of the public, pinned English speech model."""
import sys
from huggingface_hub import snapshot_download

if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Supply the local speech model destination.")
    snapshot_download(repo_id="Systran/faster-whisper-base.en",
                      revision="3d3d5dee26484f91867d81cb899cfcf72b96be6c",
                      local_dir=sys.argv[1], token=False,
                      allow_patterns=["config.json", "model.bin", "tokenizer.json", "vocabulary.*", "README.md", "LICENSE*"])
