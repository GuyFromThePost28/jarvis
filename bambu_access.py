"""
JARVIS Bambu Lab Integration — monitor and control Bambu 3D printers.

Uses the Bambu Lab local MQTT API over your home network.
Requires: BAMBU_PRINTER_IP, BAMBU_SERIAL, BAMBU_ACCESS_CODE in .env
"""
from __future__ import annotations
import asyncio
import json
import logging
import os

log = logging.getLogger("jarvis.bambu")

PRINTER_IP = os.getenv("BAMBU_PRINTER_IP", "")
SERIAL = os.getenv("BAMBU_SERIAL", "")
ACCESS_CODE = os.getenv("BAMBU_ACCESS_CODE", "")

_STATUS_TOPIC = "device/{serial}/report"
_CMD_TOPIC = "device/{serial}/request"

# Cached last known printer state
_last_status: dict = {}


def _is_configured() -> bool:
    return bool(PRINTER_IP and SERIAL and ACCESS_CODE)


async def get_printer_status() -> dict:
    """Fetch current printer status via MQTT. Returns a status dict."""
    if not _is_configured():
        return {"error": "not_configured", "message": "Bambu printer credentials not set in .env"}

    try:
        import paho.mqtt.client as mqtt  # type: ignore
    except ImportError:
        return {"error": "missing_package", "message": "Run: pip3 install paho-mqtt"}

    status: dict = {}
    event = asyncio.Event()
    loop = asyncio.get_event_loop()

    def on_connect(client, userdata, flags, rc):
        topic = _STATUS_TOPIC.format(serial=SERIAL)
        client.subscribe(topic)
        # Request a full status report
        cmd_topic = _CMD_TOPIC.format(serial=SERIAL)
        payload = json.dumps({"pushing": {"sequence_id": "0", "command": "pushall"}})
        client.publish(cmd_topic, payload)

    def on_message(client, userdata, msg):
        try:
            data = json.loads(msg.payload.decode())
            if "print" in data:
                status.update(data["print"])
                loop.call_soon_threadsafe(event.set)
        except Exception:
            pass

    client = mqtt.Client()
    client.username_pw_set("bblp", ACCESS_CODE)
    client.tls_set()
    client.tls_insecure_set(True)
    client.on_connect = on_connect
    client.on_message = on_message

    try:
        client.connect(PRINTER_IP, 8883, 60)
        client.loop_start()
        await asyncio.wait_for(event.wait(), timeout=10)
        client.loop_stop()
        client.disconnect()
        _last_status.update(status)
        return status
    except asyncio.TimeoutError:
        client.loop_stop()
        return {"error": "timeout", "message": "Printer did not respond. Check it's on and connected."}
    except Exception as e:
        return {"error": str(e), "message": f"Could not connect to printer: {e}"}


async def format_printer_status() -> str:
    """Return a plain-English description of the printer's current state."""
    if not _is_configured():
        return (
            "Bambu printer isn't configured yet, Sir. "
            "Add BAMBU_PRINTER_IP, BAMBU_SERIAL, and BAMBU_ACCESS_CODE to your .env file."
        )

    status = await get_printer_status()
    if "error" in status:
        return f"Couldn't reach the printer — {status['message']}"

    gcode_state = status.get("gcode_state", "UNKNOWN")
    mc_percent = status.get("mc_percent", 0)
    mc_remaining = status.get("mc_remaining_time", 0)
    nozzle_temp = status.get("nozzle_temper", 0)
    bed_temp = status.get("bed_temper", 0)
    subtask = status.get("subtask_name", "")

    state_map = {
        "RUNNING": "printing",
        "PAUSE": "paused",
        "FINISH": "finished",
        "FAILED": "failed",
        "IDLE": "idle",
        "PREPARE": "preparing",
        "SLICING": "slicing",
    }
    state_word = state_map.get(gcode_state, gcode_state.lower())

    if gcode_state == "RUNNING":
        hours, mins = divmod(mc_remaining, 60)
        time_left = f"{hours}h {mins}m" if hours else f"{mins}m"
        return (
            f"Printer is {state_word}, Sir. "
            f"{mc_percent}% complete on '{subtask}'. "
            f"About {time_left} remaining. "
            f"Nozzle: {nozzle_temp:.0f}°C, Bed: {bed_temp:.0f}°C."
        )
    elif gcode_state == "FINISH":
        return f"Print complete, Sir. '{subtask}' finished successfully."
    elif gcode_state == "IDLE":
        return "Printer is idle and ready, Sir."
    elif gcode_state == "PAUSE":
        return f"Print is paused at {mc_percent}%, Sir. '{subtask}'."
    else:
        return f"Printer state: {state_word}."


async def pause_print() -> dict:
    """Pause the current print."""
    if not _is_configured():
        return {"success": False, "confirmation": "Bambu printer not configured, Sir."}
    try:
        import paho.mqtt.client as mqtt  # type: ignore
        client = mqtt.Client()
        client.username_pw_set("bblp", ACCESS_CODE)
        client.tls_set()
        client.tls_insecure_set(True)
        client.connect(PRINTER_IP, 8883, 60)
        payload = json.dumps({"print": {"sequence_id": "0", "command": "pause"}})
        client.publish(_CMD_TOPIC.format(serial=SERIAL), payload)
        client.disconnect()
        return {"success": True, "confirmation": "Print paused, Sir."}
    except Exception as e:
        return {"success": False, "confirmation": f"Couldn't pause: {e}"}


async def resume_print() -> dict:
    """Resume a paused print."""
    if not _is_configured():
        return {"success": False, "confirmation": "Bambu printer not configured, Sir."}
    try:
        import paho.mqtt.client as mqtt  # type: ignore
        client = mqtt.Client()
        client.username_pw_set("bblp", ACCESS_CODE)
        client.tls_set()
        client.tls_insecure_set(True)
        client.connect(PRINTER_IP, 8883, 60)
        payload = json.dumps({"print": {"sequence_id": "0", "command": "resume"}})
        client.publish(_CMD_TOPIC.format(serial=SERIAL), payload)
        client.disconnect()
        return {"success": True, "confirmation": "Print resumed, Sir."}
    except Exception as e:
        return {"success": False, "confirmation": f"Couldn't resume: {e}"}


async def stop_print() -> dict:
    """Stop (cancel) the current print."""
    if not _is_configured():
        return {"success": False, "confirmation": "Bambu printer not configured, Sir."}
    try:
        import paho.mqtt.client as mqtt  # type: ignore
        client = mqtt.Client()
        client.username_pw_set("bblp", ACCESS_CODE)
        client.tls_set()
        client.tls_insecure_set(True)
        client.connect(PRINTER_IP, 8883, 60)
        payload = json.dumps({"print": {"sequence_id": "0", "command": "stop"}})
        client.publish(_CMD_TOPIC.format(serial=SERIAL), payload)
        client.disconnect()
        return {"success": True, "confirmation": "Print stopped, Sir."}
    except Exception as e:
        return {"success": False, "confirmation": f"Couldn't stop print: {e}"}
