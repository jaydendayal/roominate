from __future__ import annotations

import re
from typing import Any

from .schemas import FloorPlanAIResult, TracedWall

_FEET_MARKS = str.maketrans({"’": "'", "′": "'", "‘": "'", "`": "'", "”": '"', "″": '"', "“": '"', "–": "-", "—": "-", "×": "x"})

_METRIC = re.compile(r"(?P<value>\d+(?:[.,]\d+)?)\s*(?P<unit>mm|cm|m)\.?")
_IMPERIAL = re.compile(
    r"(?:(?P<feet>\d+(?:\.\d+)?)\s*(?:'|ft\.?|feet|foot))?"
    r"\s*-?\s*"
    r"(?:(?P<inches>\d+(?:\.\d+)?)?\s*(?:(?P<numerator>\d+)\s*/\s*(?P<denominator>\d+))?\s*(?P<inch_mark>\"|''|in\.?|inch(?:es)?)?)?"
)


def parse_length_text(text: str) -> float | None:
    """Meters for one printed plan dimension such as 12'-6", 12' 6 1/2", 11 ft, 3.81 m, 381 cm, or 3,810 mm.

    Returns None for anything else, including a bare number with no unit, so a model's reading of a
    label never becomes a measurement unless the label itself states one.
    """
    value = " ".join(text.translate(_FEET_MARKS).lower().split())
    if not value:
        return None
    if metric := _METRIC.fullmatch(value):
        unit = metric["unit"]
        number = metric["value"].replace(",", "") if unit == "mm" else metric["value"].replace(",", ".")
        meters = float(number) * {"mm": 0.001, "cm": 0.01, "m": 1.0}[unit]
    elif (imperial := _IMPERIAL.fullmatch(value)) and (imperial["feet"] or imperial["inch_mark"]):
        inches = float(imperial["inches"] or 0)
        if imperial["numerator"]:
            denominator = int(imperial["denominator"])
            if denominator == 0:
                return None
            inches += int(imperial["numerator"]) / denominator
        if imperial["feet"] is None and imperial["inches"] is None and not imperial["numerator"]:
            return None
        meters = (float(imperial["feet"] or 0) * 12 + inches) * 0.0254
    else:
        return None
    return round(meters, 4) if 0.05 <= meters <= 60 else None


def reviewed_plan_reading(result: FloorPlanAIResult, walls: list[TracedWall]) -> dict[str, Any]:
    """Keeps only readings tied to the room: dimensions whose printed text parses to a length, on a wall
    that exists or across the whole room, and openings with any unknown wall letter cleared."""
    labels = {wall.label for wall in walls}
    dimensions = []
    for dimension in result.dimensions:
        meters = parse_length_text(dimension.text)
        if meters is None or not 0.1 <= meters <= 30 or dimension.spans == "other":
            continue
        wall_label = dimension.wall_label if dimension.wall_label in labels else None
        if dimension.spans == "wall" and wall_label is None:
            continue
        dimensions.append({**dimension.model_dump(), "meters": meters, "wall_label": wall_label if dimension.spans == "wall" else None})
    openings = [
        {**opening.model_dump(), "wall_label": opening.wall_label if opening.wall_label in labels else None}
        for opening in result.openings
    ]
    return {
        "schema_version": result.schema_version,
        "processing_status": result.processing_status,
        "dimensions": dimensions,
        "openings": openings,
        "uncertainties": result.uncertainties,
    }
