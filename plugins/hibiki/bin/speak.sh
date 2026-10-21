#!/usr/bin/env bash
# Streams PCM from an OpenAI-compatible /audio/speech endpoint into a local player.
#
# stdin : the JSON request body
# env   : TTS_URL          full URL of the speech endpoint (required)
#         TTS_PLAYER       ffplay | play | paplay | aplay (required, no fallback)
#
# curl and the player are separate children so a TERM stops both
# (the mod kills this script when the user presses stop).
set -u

[ -n "${TTS_URL:-}" ] || { echo "TTS_URL is not set" >&2; exit 2; }
command -v curl >/dev/null || { echo "curl not found" >&2; exit 2; }

# Check the player before asking the server for anything.
player="${TTS_PLAYER:-}"
case "$player" in
  ffplay|play|paplay|aplay) ;;
  "") echo "TTS_PLAYER is not set (ffplay | play | paplay | aplay)" >&2; exit 2 ;;
  *)  echo "unknown player: $player (ffplay | play | paplay | aplay)" >&2; exit 2 ;;
esac
command -v "$player" >/dev/null || { echo "$player not found on PATH" >&2; exit 2; }

work=$(mktemp -d "${TMPDIR:-/tmp}/hibiki.XXXXXX") || exit 2
body="$work/body.json"
hdr="$work/headers"
fifo="$work/pcm"
curl_pid=""
player_pid=""

cleanup() {
  [ -n "$player_pid" ] && kill "$player_pid" 2>/dev/null
  [ -n "$curl_pid" ] && kill "$curl_pid" 2>/dev/null
  rm -rf "$work"
}
trap 'cleanup; exit 143' TERM INT HUP
trap cleanup EXIT

cat > "$body"
mkfifo "$fifo" || exit 2

# -o opens the fifo only when the first body byte arrives, so the
# headers land in $hdr before anything blocks on the fifo.
curl -sS -N -D "$hdr" -o "$fifo" \
  -H 'Content-Type: application/json' \
  --data-binary @"$body" "$TTS_URL" &
curl_pid=$!

# Wait for the end of the response headers (or for curl to give up).
while :; do
  if [ -f "$hdr" ] && grep -q $'^\r$' "$hdr"; then break; fi
  if ! kill -0 "$curl_pid" 2>/dev/null; then
    wait "$curl_pid"; code=$?
    echo "could not reach $TTS_URL (curl exit $code)" >&2
    exit 1
  fi
  sleep 0.02
done

status=$(head -n1 "$hdr" | awk '{print $2}')
if [ "${status:0:1}" != "2" ]; then
  # The error body (OpenAI's error JSON) goes to stderr for the mod to show.
  cat "$fifo" >&2 &
  wait "$curl_pid"
  echo >&2
  echo "HTTP $status from $TTS_URL" >&2
  exit 1
fi

# The rate the server streams at; OpenAI's pcm is 24000 and sends no header.
rate=$(tr -d '\r' < "$hdr" | awk -F': *' 'tolower($1)=="x-sample-rate"{print $2}' | tail -n1)
[ -n "$rate" ] || rate=24000

case "$player" in
  ffplay)
    if ffplay -hide_banner -h demuxer=s16le 2>/dev/null | grep -q ch_layout; then
      layout=(-ch_layout mono)
    else
      layout=(-ac 1)
    fi
    cmd=(ffplay -nodisp -autoexit -hide_banner -loglevel error -f s16le -ar "$rate" "${layout[@]}" -i -) ;;
  play)   cmd=(play -q -t raw -e signed-integer -b 16 -c 1 -r "$rate" -) ;;
  paplay) cmd=(paplay --raw --format=s16le --rate="$rate" --channels=1) ;;
  aplay)  cmd=(aplay -q -f S16_LE -r "$rate" -c 1) ;;
esac

"${cmd[@]}" < "$fifo" &
player_pid=$!

wait "$player_pid"; player_code=$?
wait "$curl_pid"; curl_code=$?
curl_pid=""; player_pid=""

if [ "$curl_code" -ne 0 ]; then
  echo "stream ended early (curl exit $curl_code)" >&2
  exit 1
fi
exit "$player_code"
