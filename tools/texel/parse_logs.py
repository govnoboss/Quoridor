import json
from pathlib import Path

ROOT = Path(r"C:\Users\Student\Documents\GitHub\Quoridor")
LOGS = [
  ROOT / "quoridor-engine" / "rr3.jsonl",
  ROOT / "quoridor-engine" / "arena" / "results" / "selftest.jsonl",
  ROOT / "quoridor-engine" / "arena" / "results" / "gui-test.jsonl",
  ROOT / "quoridor-engine" / "arena" / "results" / "probe-hard-vs-medium.jsonl",
  ROOT / "quoridor-engine" / "arena" / "results" / "probe-hard-vs-random.jsonl",
  ROOT / "quoridor-engine" / "arena" / "results" / "probe-medium-vs-easy.jsonl",
  ROOT / "files" / "quoridor-arena" / "quoridor-arena" / "results" / "selftest.jsonl",
]

def main():
  total = 0
  for p in LOGS:
    if not p.exists():
      continue
    with open(p, encoding='utf-8') as f:
      for line in f:
        line = line.strip()
        if not line:
          continue
        try:
          d = json.loads(line)
        except Exception:
          continue
        total += 1
  print(total)

if __name__ == '__main__':
  main()
