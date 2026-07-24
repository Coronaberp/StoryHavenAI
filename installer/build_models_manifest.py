import argparse
import asyncio
import os
import re
import sys

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import create_async_engine

CATEGORY_BY_TYPE = {
    "checkpoint": "checkpoints",
    "lora": "loras",
    "upscaler": "upscale_models",
    "anima": "diffusion_models",
    "wan": "diffusion_models",
}

EXTENSION_BY_CATEGORY = {
    "upscale_models": ".pth",
}


def slugify(name: str) -> str:
    cleaned = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
    return re.sub(r"_+", "_", cleaned)


def manifest_row(category: str, filename: str, url: str, is_default: bool) -> str:
    return f"{category}\t{filename}\t{url}\t{1 if is_default else 0}"


async def fetch_rows(database_url: str) -> list:
    engine = create_async_engine(database_url)
    async with engine.connect() as conn:
        result = await conn.execute(sa.text(
            "select model_name, request_type, source_url, vae_url, text_encoder_url "
            "from model_requests where status = 'implemented' order by created"))
        rows = result.fetchall()
    await engine.dispose()
    return rows


def build(rows, default_patterns, extras) -> list[str]:
    seen = set()
    out = []
    for model_name, request_type, source_url, vae_url, text_encoder_url in rows:
        category = CATEGORY_BY_TYPE.get(request_type)
        if not category or not source_url:
            continue
        slug = slugify(model_name)
        extension = EXTENSION_BY_CATEGORY.get(category, ".safetensors")
        filename = slug + extension
        if filename in seen:
            continue
        seen.add(filename)
        is_default = any(p in slug for p in default_patterns)
        out.append(manifest_row(category, filename, source_url, is_default))
        if vae_url:
            out.append(manifest_row("vae", slug + "_vae.safetensors", vae_url, is_default))
        if text_encoder_url:
            out.append(manifest_row("text_encoders", slug + "_text_encoder.safetensors", text_encoder_url, is_default))
    for extra in extras:
        parts = extra.split("|")
        if len(parts) != 4:
            sys.exit(f"bad --extra (want category|filename|url|default01): {extra}")
        out.append(manifest_row(parts[0], parts[1], parts[2], parts[3] == "1"))
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="installer/models.manifest.tsv")
    parser.add_argument("--default", action="append", default=[],
                        help="substring of a model slug to mark as a default download")
    parser.add_argument("--extra", action="append", default=[],
                        help="category|filename|url|default01 for models not in the request table")
    args = parser.parse_args()
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        sys.exit("DATABASE_URL must be set")
    rows = asyncio.run(fetch_rows(database_url))
    lines = build(rows, [slugify(p) for p in args.default], args.extra)
    with open(args.out, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")
    defaults = sum(1 for line in lines if line.endswith("\t1"))
    print(f"wrote {len(lines)} rows ({defaults} default) to {args.out}")


if __name__ == "__main__":
    main()
