"""
Vader Alarm & Clock Access — set alarms and timers via macOS Reminders and system tools.
"""
from __future__ import annotations
import asyncio
import logging
import re
from datetime import datetime, timedelta

log = logging.getLogger("vader.alarm")


async def _run_script(script: str) -> str:
    try:
        proc = await asyncio.create_subprocess_exec(
            "osascript", "-e", script,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=8)
        return stdout.decode().strip()
    except Exception as e:
        log.error(f"Alarm AppleScript error: {e}")
        return ""


def _parse_time_string(time_str: str) -> datetime | None:
    """Parse a time string like '3pm', '15:30', 'in 10 minutes', '9:00 AM' into a datetime."""
    now = datetime.now()
    time_str = time_str.strip().lower()

    # "in X minutes/hours"
    in_match = re.search(r'in\s+(\d+)\s+(minute|hour|second)', time_str)
    if in_match:
        amount = int(in_match.group(1))
        unit = in_match.group(2)
        if unit.startswith("minute"):
            return now + timedelta(minutes=amount)
        elif unit.startswith("hour"):
            return now + timedelta(hours=amount)
        elif unit.startswith("second"):
            return now + timedelta(seconds=amount)

    # "3pm", "3:30pm", "15:30", "9:00 AM"
    time_pattern = re.search(r'(\d{1,2})(?::(\d{2}))?\s*(am|pm)?', time_str)
    if time_pattern:
        hour = int(time_pattern.group(1))
        minute = int(time_pattern.group(2) or 0)
        meridiem = time_pattern.group(3)
        if meridiem == "pm" and hour != 12:
            hour += 12
        elif meridiem == "am" and hour == 12:
            hour = 0
        target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if target <= now:
            target += timedelta(days=1)
        return target

    return None


async def set_alarm(time_str: str, label: str = "Alarm") -> dict:
    """Set an alarm via Apple Reminders at the specified time."""
    target = _parse_time_string(time_str)
    if not target:
        return {"success": False, "confirmation": f"I couldn't understand the time '{time_str}', Sir."}

    # Format for AppleScript: "Friday, May 7, 2026 at 3:00 PM"
    remind_date = target.strftime("%B %d, %Y at %I:%M %p")
    escaped_label = label.replace('"', '\\"')

    script = f'''
tell application "Reminders"
    set newReminder to make new reminder with properties {{name:"{escaped_label}", remind me date:date "{remind_date}"}}
end tell
'''
    await _run_script(script)
    time_display = target.strftime("%-I:%M %p")
    return {"success": True, "confirmation": f"Alarm set for {time_display} — '{label}', Sir."}


async def set_timer(minutes: int, label: str = "Timer") -> dict:
    """Set a countdown timer using a Reminder."""
    target = datetime.now() + timedelta(minutes=minutes)
    return await set_alarm(target.strftime("%I:%M %p"), label or f"{minutes} minute timer")


async def list_alarms() -> list[dict]:
    """Get upcoming reminders from Apple Reminders."""
    script = '''
tell application "Reminders"
    set upcoming to {}
    set allReminders to every reminder of default list
    repeat with r in allReminders
        if remind me date of r is not missing value then
            set upcoming to upcoming & {name of r & "|||" & (remind me date of r as string)}
        end if
    end repeat
    return upcoming
end tell
'''
    result = await _run_script(script)
    alarms = []
    if result:
        for line in result.split(", "):
            if "|||" in line:
                parts = line.split("|||")
                alarms.append({"label": parts[0], "time": parts[1] if len(parts) > 1 else ""})
    return alarms


async def format_alarms_summary() -> str:
    """Return a plain-English summary of upcoming alarms."""
    alarms = await list_alarms()
    if not alarms:
        return "No alarms or reminders set."
    lines = [f"{a['label']} at {a['time']}" for a in alarms[:5]]
    return "Upcoming alarms: " + ", ".join(lines) + "."
