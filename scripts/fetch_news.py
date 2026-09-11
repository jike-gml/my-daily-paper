#!/usr/bin/env python3
import json
import re
import html
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

SOURCES = [
    {
        "name": "Google Japan Blog",
        "url": "https://blog.google/intl/ja-jp/rss/",
        "category": "technology",
        "language": "ja",
    },
    {
        "name": "NVIDIA Newsroom",
        "url": "https://nvidianews.nvidia.com/releases.xml",
        "category": "technology",
        "language": "en",
    },
]

UA = "MY-DAILY-PAPER/1.0 (+https://jike-gml.github.io/my-daily-paper/)"


def clean_text(value):
    if not value:
        return ""
    value = html.unescape(value)
    value = re.sub(r"<script\b[^>]*>.*?</script>", " ", value, flags=re.I | re.S)
    value = re.sub(r"<style\b[^>]*>.*?</style>", " ", value, flags=re.I | re.S)
    value = re.sub(r"<[^>]+>", " ", value)
    value = re.sub(r"\s+", " ", value).strip()
    return value


def parse_date(value):
    if not value:
        return None
    try:
        dt = parsedate_to_datetime(value)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        pass
    try:
        v = value.replace("Z", "+00:00")
        dt = datetime.fromisoformat(v)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None


def text_of(node, names):
    for child in list(node):
        local = child.tag.split("}")[-1]
        if local in names and child.text:
            return child.text
    return ""


def link_of(node):
    for child in list(node):
        local = child.tag.split("}")[-1]
        if local != "link":
            continue
        href = child.attrib.get("href")
        rel = child.attrib.get("rel", "alternate")
        if href and rel in ("alternate", ""):
            return href
        if child.text and child.text.strip().startswith("http"):
            return child.text.strip()
    return ""


def parse_feed(xml_bytes, source):
    root = ET.fromstring(xml_bytes)
    root_local = root.tag.split("}")[-1].lower()
    nodes = []
    if root_local == "rss":
        channel = next((c for c in list(root) if c.tag.split("}")[-1] == "channel"), root)
        nodes = [c for c in list(channel) if c.tag.split("}")[-1] == "item"]
    elif root_local == "feed":
        nodes = [c for c in list(root) if c.tag.split("}")[-1] == "entry"]
    else:
        nodes = [n for n in root.iter() if n.tag.split("}")[-1] in ("item", "entry")]

    items = []
    for node in nodes:
        title = clean_text(text_of(node, {"title"}))
        summary = clean_text(text_of(node, {"description", "summary", "content", "encoded"}))
        link = link_of(node)
        published_raw = text_of(node, {"pubDate", "published", "updated", "date"})
        published = parse_date(published_raw)
        if not title or not link:
            continue
        items.append({
            "title": title,
            "summary": summary[:420],
            "url": link,
            "published_at": published.isoformat().replace("+00:00", "Z") if published else None,
            "source": source["name"],
            "category": source["category"],
            "language": source["language"],
        })
    return items


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*"})
    with urllib.request.urlopen(req, timeout=30) as res:
        return res.read()


def main():
    all_items = []
    errors = []
    for source in SOURCES:
        try:
            all_items.extend(parse_feed(fetch(source["url"]), source))
        except Exception as exc:
            errors.append({"source": source["name"], "error": str(exc)})

    seen = set()
    deduped = []
    for item in all_items:
        key = item["url"].split("#", 1)[0].rstrip("/") or item["title"].lower()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(item)

    deduped.sort(key=lambda x: x.get("published_at") or "", reverse=True)
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "category": "technology",
        "sources": [{"name": s["name"], "url": s["url"]} for s in SOURCES],
        "items": deduped[:20],
        "errors": errors,
    }
    Path("news.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(payload['items'])} items; {len(errors)} source errors")


if __name__ == "__main__":
    main()
