"use client";

import { useState, type InputHTMLAttributes } from "react";
import { fromUnit, lengthInputValue, type LengthUnit } from "@/lib/units";

type NativeInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "defaultValue" | "onChange">;

/**
 * Numeric input for a length stored in meters but edited in the user's display unit.
 * While focused it keeps the raw text so partial entries like "12." are not reformatted mid-typing.
 */
export function LengthInput({ meters, unit, onChange, onFocus, onBlur, ...rest }: NativeInputProps & {
  meters: number | null;
  unit: LengthUnit;
  onChange: (meters: number | null) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      {...rest}
      type="number"
      inputMode="decimal"
      value={draft ?? lengthInputValue(meters, unit)}
      onFocus={(event) => { setDraft(lengthInputValue(meters, unit)); onFocus?.(event); }}
      onBlur={(event) => { setDraft(null); onBlur?.(event); }}
      onChange={(event) => {
        const text = event.target.value;
        setDraft(text);
        if (text.trim() === "") return onChange(null);
        const value = Number(text);
        if (Number.isFinite(value)) onChange(fromUnit(value, unit));
      }}
    />
  );
}
