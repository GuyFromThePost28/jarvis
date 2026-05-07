"""
Vader Location & Weather — live location via IP geolocation + rich weather via Open-Meteo.
No API key required for either service.
"""
from __future__ import annotations

import json
import logging
import time
import urllib.request
from typing import Optional

log = logging.getLogger("vader.location")

# WMO weather code → human description
_WMO_CODES: dict[int, str] = {
    0: "clear sky", 1: "mainly clear", 2: "partly cloudy", 3: "overcast",
    45: "foggy", 48: "icy fog",
    51: "light drizzle", 53: "drizzle", 55: "heavy drizzle",
    61: "light rain", 63: "rain", 65: "heavy rain",
    71: "light snow", 73: "snow", 75: "heavy snow", 77: "snow grains",
    80: "light showers", 81: "showers", 82: "violent showers",
    85: "snow showers", 86: "heavy snow showers",
    95: "thunderstorm", 96: "thunderstorm with hail", 99: "severe thunderstorm",
}

_cached_location: Optional[dict] = None
_location_fetched_at: float = 0
_LOCATION_TTL = 300  # re-check location every 5 minutes


def get_location() -> dict:
    """Return current location via IP geolocation. Cached for 5 minutes."""
    global _cached_location, _location_fetched_at
    now = time.time()
    if _cached_location and (now - _location_fetched_at) < _LOCATION_TTL:
        return _cached_location

    try:
        req = urllib.request.Request(
            "http://ip-api.com/json/?fields=lat,lon,city,regionName,country,timezone",
            headers={"User-Agent": "Vader/1.0"},
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read())
            _cached_location = {
                "lat": data.get("lat", 0.0),
                "lon": data.get("lon", 0.0),
                "city": data.get("city", "Unknown"),
                "region": data.get("regionName", ""),
                "country": data.get("country", ""),
                "timezone": data.get("timezone", ""),
            }
            _location_fetched_at = now
            log.info(f"Location: {_cached_location['city']}, {_cached_location['region']}")
            return _cached_location
    except Exception as e:
        log.warning(f"Location fetch failed: {e}")
        return _cached_location or {"lat": 0, "lon": 0, "city": "Unknown", "region": "", "country": "", "timezone": ""}


def get_weather(lat: float, lon: float, city: str) -> str:
    """Fetch current weather from Open-Meteo for given coordinates."""
    try:
        url = (
            f"https://api.open-meteo.com/v1/forecast"
            f"?latitude={lat}&longitude={lon}"
            f"&current=temperature_2m,weathercode,windspeed_10m,relativehumidity_2m"
            f"&temperature_unit=fahrenheit&windspeed_unit=mph&timezone=auto"
        )
        with urllib.request.urlopen(url, timeout=5) as resp:
            d = json.loads(resp.read()).get("current", {})
            temp = d.get("temperature_2m", "?")
            code = d.get("weathercode", 0)
            wind = d.get("windspeed_10m", "?")
            humidity = d.get("relativehumidity_2m", "?")
            condition = _WMO_CODES.get(code, "unknown conditions")
            return f"{city}: {temp}°F, {condition}, wind {wind} mph, humidity {humidity}%"
    except Exception as e:
        log.warning(f"Weather fetch failed: {e}")
        return f"Weather unavailable for {city}."


def get_live_weather() -> str:
    """Convenience function: get location then weather in one call."""
    loc = get_location()
    return get_weather(loc["lat"], loc["lon"], loc["city"])


def format_location_summary() -> str:
    """Return a plain-English location string for Vader's context."""
    loc = get_location()
    if loc["city"] == "Unknown":
        return "Location unavailable."
    parts = [loc["city"]]
    if loc["region"]:
        parts.append(loc["region"])
    if loc["country"] and loc["country"] != "United States":
        parts.append(loc["country"])
    return ", ".join(parts)
