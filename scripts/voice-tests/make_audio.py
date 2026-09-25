#!/usr/bin/env python3
"""Generate the Glyph voice test recordings (voice-tests/suite.json) with ElevenLabs.

Each take is a list of lines with a pause after each. Every line is
synthesised on its own and the pauses are real silence spliced in with
ffmpeg, rather than <break> tags: break tags are capped near three seconds
and get unstable when a passage has many of them, and the cue rules under
test depend on the pause lengths being exact.

The API key is read from a file (never an argument, never printed). The
neighbouring lines are sent as `previous_text`/`next_text` so the delivery
flows as one take instead of nine disconnected sentences.

    python3 scripts/voice-tests/make_audio.py --voices          # list the voices on the account
    python3 scripts/voice-tests/make_audio.py --voice <id>      # generate every test
    python3 scripts/voice-tests/make_audio.py --voice <id> --take 051

Each test in the suite becomes <file>.mp3 in ~/Desktop/glyph-voice-tests, which is where
`npm run voice:suite` looks for them. A file already there is kept; pass --again to redo it.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import subprocess
import sys
import urllib.error
import urllib.request

API = "https://api.elevenlabs.io/v1"
KEY_FILE = pathlib.Path.home() / ".elevenlabs-key"
OUT = pathlib.Path.home() / "Desktop" / "glyph-voice-tests"
MODEL = "eleven_multilingual_v2"
FORMAT = "mp3_44100_128"

SUITE = pathlib.Path(__file__).resolve().parents[2] / "voice-tests" / "suite.json"


def load_takes() -> dict[str, list[tuple[str, float]]]:
    """(line, seconds of silence after it) per test, from the suite."""
    suite = json.loads(SUITE.read_text())
    return {test["file"]: [(line, float(gap)) for line, gap in test["lines"]] for test in suite["tests"]}


TAKES = load_takes()


def key() -> str:
    if not KEY_FILE.exists():
        sys.exit(f"No key at {KEY_FILE}. Put the ElevenLabs key in that file, one line, chmod 600.")
    value = KEY_FILE.read_text().strip()
    if not value:
        sys.exit(f"{KEY_FILE} is empty.")
    return value


def call(path: str, token: str, body: dict | None = None) -> bytes:
    request = urllib.request.Request(
        f"{API}{path}",
        data=json.dumps(body).encode() if body else None,
        headers={"xi-api-key": token, "Content-Type": "application/json", "Accept": "*/*"},
        method="POST" if body else "GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=180) as answer:
            return answer.read()
    except urllib.error.HTTPError as error:
        detail = error.read().decode(errors="replace")[:400]
        # The key itself is never in the message: only the status and the API's words.
        sys.exit(f"ElevenLabs said {error.code} for {path}: {detail}")


def voices(token: str) -> None:
    listing = json.loads(call("/voices", token))
    for voice in listing.get("voices", []):
        labels = voice.get("labels") or {}
        traits = ", ".join(str(v) for v in labels.values()) or voice.get("category", "")
        print(f"{voice['voice_id']}  {voice['name']:<22} {traits}")


def say_locally(voice: str, text: str, out: pathlib.Path) -> None:
    """macOS's own voice, for trying the suite without an ElevenLabs key: rougher, and free."""
    aiff = out.with_suffix(".aiff")
    command = ["say", "-o", str(aiff)] + (["-v", voice] if voice != "system" else []) + [text]
    run(command)
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(aiff), str(out)])
    aiff.unlink(missing_ok=True)


def say(token: str, voice: str, text: str, before: str, after: str, out: pathlib.Path) -> None:
    if token == "local":
        say_locally(voice, text, out)
        return
    body = {
        "text": text,
        "model_id": MODEL,
        "previous_text": before,
        "next_text": after,
        "voice_settings": {"stability": 0.55, "similarity_boost": 0.75, "style": 0.0, "use_speaker_boost": True},
    }
    out.write_bytes(call(f"/text-to-speech/{voice}?output_format={FORMAT}", token, body))


def run(command: list[str]) -> None:
    done = subprocess.run(command, capture_output=True)
    if done.returncode:
        sys.exit(done.stderr.decode(errors="replace")[-600:])


def build(name: str, lines: list[tuple[str, float]], token: str, voice: str) -> pathlib.Path:
    work = OUT / ".parts" / name
    work.mkdir(parents=True, exist_ok=True)
    pieces: list[pathlib.Path] = []
    for i, (text, gap) in enumerate(lines):
        before = lines[i - 1][0] if i else ""
        after = lines[i + 1][0] if i + 1 < len(lines) else ""
        tag = hashlib.sha1(f"{voice}|{text}|{before}|{after}".encode()).hexdigest()[:10]
        mp3 = work / f"{i:02d}-{tag}.mp3"
        wav = work / f"{i:02d}-{tag}.wav"
        if not mp3.exists():
            print(f"  {name}: line {i + 1} of {len(lines)}")
            say(token, voice, text, before, after, mp3)
        run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(mp3), "-ar", "44100", "-ac", "1", str(wav)])
        pieces.append(wav)
        if gap > 0:
            quiet = work / f"{i:02d}-gap.wav"
            run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"anullsrc=r=44100:cl=mono", "-t", str(gap), str(quiet)])
            pieces.append(quiet)
    listing = work / "list.txt"
    listing.write_text("".join(f"file '{p}'\n" for p in pieces))
    final = OUT / f"{name}.mp3"
    run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(listing), "-codec:a", "libmp3lame", "-b:a", "128k", str(final)])
    return final


def seconds(path: pathlib.Path) -> float:
    done = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path)],
        capture_output=True,
    )
    try:
        return float(done.stdout.decode().strip())
    except ValueError:
        return 0.0


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--voices", action="store_true", help="list the voices on the account and stop")
    parser.add_argument("--voice", help="voice id to speak with")
    parser.add_argument("--take", help="one test by name or number, else all")
    parser.add_argument("--again", action="store_true", help="make files that already exist again")
    parser.add_argument("--say", metavar="VOICE", help="use macOS `say` with this voice (or 'system') instead of ElevenLabs")
    parser.add_argument("--out", help="folder to write to (default ~/Desktop/glyph-voice-tests)")
    args = parser.parse_args()
    global OUT
    if args.out:
        OUT = pathlib.Path(args.out).expanduser()
    if args.say:
        args.voice = args.say
        token = "local"
    else:
        token = key()
    if args.voices:
        voices(token)
        return
    if not args.voice:
        sys.exit("Pass --voice <id>; --voices lists them.")
    OUT.mkdir(parents=True, exist_ok=True)
    wanted = {
        name: lines
        for name, lines in TAKES.items()
        if not args.take or args.take == name or name.startswith(f"{args.take}-")
    }
    if not wanted:
        sys.exit(f"No take called {args.take}. Names: {', '.join(TAKES)}")
    for name, lines in wanted.items():
        if (OUT / f"{name}.mp3").exists() and not args.again:
            print(f"{name}.mp3  already there")
            continue
        made = build(name, lines, token, args.voice)
        print(f"{made.name}  {seconds(made):.1f}s")
    print(f"\nIn {OUT}")


if __name__ == "__main__":
    main()
