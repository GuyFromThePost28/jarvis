"""
JARVIS Spotify Access — control Spotify on Mac via AppleScript.
"""
from __future__ import annotations
import asyncio
import logging

log = logging.getLogger("jarvis.spotify")


async def _run_spotify_script(script: str) -> str:
    """Run an AppleScript targeting Spotify and return the output."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "osascript", "-e", script,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=8)
        return stdout.decode().strip()
    except Exception as e:
        log.error(f"Spotify AppleScript error: {e}")
        return ""


async def _ensure_spotify_running() -> bool:
    """Launch Spotify if not already running."""
    check = 'tell application "System Events" to (name of processes) contains "Spotify"'
    result = await _run_spotify_script(check)
    if result.lower() != "true":
        proc = await asyncio.create_subprocess_exec(
            "open", "-a", "Spotify",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        await proc.communicate()
        await asyncio.sleep(3)
    return True


async def get_current_track() -> dict:
    """Get the currently playing track info."""
    script = '''
tell application "Spotify"
    if player state is playing then
        set t to name of current track
        set a to artist of current track
        set al to album of current track
        return t & "|||" & a & "|||" & al & "|||playing"
    else if player state is paused then
        set t to name of current track
        set a to artist of current track
        return t & "|||" & a & "|||" & album of current track & "|||paused"
    else
        return "|||||||stopped"
    end if
end tell
'''
    result = await _run_spotify_script(script)
    if not result:
        return {"track": None, "artist": None, "album": None, "state": "stopped"}
    parts = result.split("|||")
    return {
        "track": parts[0] if len(parts) > 0 else None,
        "artist": parts[1] if len(parts) > 1 else None,
        "album": parts[2] if len(parts) > 2 else None,
        "state": parts[3] if len(parts) > 3 else "unknown",
    }


async def play_pause() -> dict:
    """Toggle play/pause."""
    await _ensure_spotify_running()
    script = 'tell application "Spotify" to playpause'
    await _run_spotify_script(script)
    track = await get_current_track()
    state = track.get("state", "unknown")
    return {"success": True, "confirmation": f"{'Paused' if state == 'paused' else 'Playing'}."}


async def play_track(query: str) -> dict:
    """Search for and play a track by name/artist."""
    await _ensure_spotify_running()
    # Use Spotify URI search via AppleScript
    escaped = query.replace('"', '\\"')
    script = f'''
tell application "Spotify"
    set searchResult to search "{escaped}" type track
    if searchResult is not {{}} then
        play track (item 1 of searchResult)
        set t to name of current track
        set a to artist of current track
        return t & "|||" & a
    else
        return "not_found"
    end if
end tell
'''
    result = await _run_spotify_script(script)
    if result == "not_found" or not result:
        # Fallback: open Spotify search in browser
        from urllib.parse import quote
        search_url = f"https://open.spotify.com/search/{quote(query)}"
        proc = await asyncio.create_subprocess_exec(
            "open", search_url,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        await proc.communicate()
        return {"success": True, "confirmation": f"Opened Spotify search for '{query}', Sir."}
    parts = result.split("|||")
    track = parts[0] if parts else query
    artist = parts[1] if len(parts) > 1 else ""
    return {"success": True, "confirmation": f"Playing {track} by {artist}, Sir."}


async def next_track() -> dict:
    """Skip to the next track."""
    await _ensure_spotify_running()
    await _run_spotify_script('tell application "Spotify" to next track')
    await asyncio.sleep(0.5)
    track = await get_current_track()
    name = track.get("track") or "next track"
    return {"success": True, "confirmation": f"Skipped. Now playing {name}, Sir."}


async def previous_track() -> dict:
    """Go back to the previous track."""
    await _ensure_spotify_running()
    await _run_spotify_script('tell application "Spotify" to previous track')
    await asyncio.sleep(0.5)
    track = await get_current_track()
    name = track.get("track") or "previous track"
    return {"success": True, "confirmation": f"Going back. Now playing {name}, Sir."}


async def set_volume(level: int) -> dict:
    """Set Spotify volume 0-100."""
    level = max(0, min(100, level))
    await _ensure_spotify_running()
    await _run_spotify_script(f'tell application "Spotify" to set sound volume to {level}')
    return {"success": True, "confirmation": f"Volume set to {level}, Sir."}


async def format_now_playing() -> str:
    """Return a sentence describing what's currently playing."""
    track = await get_current_track()
    if track["state"] == "stopped" or not track["track"]:
        return "Spotify is not playing anything at the moment."
    state_word = "Playing" if track["state"] == "playing" else "Paused on"
    return f"{state_word} {track['track']} by {track['artist']}."
