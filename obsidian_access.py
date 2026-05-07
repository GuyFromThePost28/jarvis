"""
Vader Obsidian Integration — mirrors memories and notes to a local vault as markdown files.
Obsidian can open the vault folder to display and graph all of Vader's knowledge.
"""
from __future__ import annotations

import logging
import os
import re
from datetime import datetime
from pathlib import Path

log = logging.getLogger("vader.obsidian")

_vault: Path | None = None


def _get_vault() -> Path | None:
    global _vault
    if _vault is None:
        raw = os.getenv("OBSIDIAN_VAULT", "").strip()
        if raw:
            _vault = Path(raw).expanduser()
        else:
            # Default: vault/ folder next to this file
            _vault = Path(__file__).parent / "vault"
    _vault.mkdir(parents=True, exist_ok=True)
    return _vault


def _slug(text: str, max_len: int = 40) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_-]+", "-", text)
    return text[:max_len].strip("-")


def write_memory(content: str, mem_type: str = "fact", importance: int = 7, tags: list[str] | None = None) -> None:
    """Write a memory to vault/Memories/<date>-<slug>.md"""
    vault = _get_vault()
    if vault is None:
        return
    memories_dir = vault / "Memories"
    memories_dir.mkdir(exist_ok=True)

    date_str = datetime.now().strftime("%Y-%m-%d")
    slug = _slug(content)
    filename = f"{date_str}-{slug}.md"
    filepath = memories_dir / filename

    tag_list = tags or [mem_type]
    tags_yaml = ", ".join(f'"{t}"' for t in tag_list)

    md = f"""---
type: {mem_type}
importance: {importance}
date: {date_str}
tags: [{tags_yaml}]
---

{content}
"""
    try:
        filepath.write_text(md, encoding="utf-8")
        log.info(f"Obsidian memory written: {filename}")
    except Exception as e:
        log.error(f"Failed to write Obsidian memory: {e}")


def write_note(title: str, body: str, topic: str = "general") -> None:
    """Write a note to vault/Notes/<topic>/<title>.md"""
    vault = _get_vault()
    if vault is None:
        return
    topic_dir = vault / "Notes" / _slug(topic)
    topic_dir.mkdir(parents=True, exist_ok=True)

    filename = _slug(title) + ".md"
    filepath = topic_dir / filename
    date_str = datetime.now().strftime("%Y-%m-%d")

    md = f"""---
title: {title}
topic: {topic}
date: {date_str}
---

{body}
"""
    try:
        filepath.write_text(md, encoding="utf-8")
        log.info(f"Obsidian note written: {topic}/{filename}")
    except Exception as e:
        log.error(f"Failed to write Obsidian note: {e}")


def read_vault(query: str, max_results: int = 5) -> str:
    """Search all .md files in the vault for a keyword and return matching excerpts."""
    vault = _get_vault()
    if vault is None:
        return "Obsidian vault not configured."

    query_lower = query.lower()
    results: list[tuple[str, str]] = []

    for md_file in vault.rglob("*.md"):
        try:
            text = md_file.read_text(encoding="utf-8")
            if query_lower in text.lower():
                # Strip frontmatter for excerpt
                body = re.sub(r"^---.*?---\s*", "", text, flags=re.DOTALL).strip()
                excerpt = body[:300].replace("\n", " ")
                relative = str(md_file.relative_to(vault))
                results.append((relative, excerpt))
                if len(results) >= max_results:
                    break
        except Exception:
            continue

    if not results:
        return f"No Obsidian notes found matching '{query}'."

    lines = [f"**{path}**: {excerpt}" for path, excerpt in results]
    return "From your Obsidian vault:\n" + "\n\n".join(lines)
