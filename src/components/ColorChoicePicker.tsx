"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { colorGroupsFor, isCustomColor, selectedChoice, type ColorGroup } from "@/lib/productColors";
import type { Item, Product } from "@/lib/types";

type Selection = Item["colorSelection"];

const CUSTOM = "__custom";
const LISTED = "__listed";
const CUSTOM_SWATCH = "conic-gradient(#e0433b, #f0c419, #4caf50, #2f8fd8, #8e5bd4, #e0433b)";

/** Swatch fill: a solid color, or a diagonal split for two-tone finishes. */
function swatchStyle(hex: string, secondary?: string): CSSProperties {
  return { background: secondary && secondary !== hex ? `linear-gradient(135deg, ${hex} 50%, ${secondary} 50%)` : hex };
}

interface SwatchOption {
  value: string;
  label: string;
  background: CSSProperties;
}

/**
 * Dropdown that shows a color swatch next to every option. Native <select> menus can't render
 * swatches, so this is a button + listbox with keyboard support (arrows, Home/End, Enter/Space,
 * Escape, type-ahead). The list is portaled to <body> so card overflow can't clip it.
 */
function SwatchSelect({ options, value, onChange, label }: { options: SwatchOption[]; value: string; onChange: (value: string) => void; label: string }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const current = options[selectedIndex];

  const place = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const below = window.innerHeight - rect.bottom - 8;
    const above = rect.top - 8;
    const openUp = below < 180 && above > below;
    const maxHeight = Math.min(280, Math.max(120, openUp ? above : below));
    setPosition({ left: rect.left, width: Math.max(rect.width, 200), maxHeight, top: openUp ? rect.top - 4 - maxHeight : rect.bottom + 4 });
  };

  useLayoutEffect(() => {
    if (!open) return;
    place();
    setActive(selectedIndex);
    listRef.current?.focus({ preventScroll: true });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    // Resize events target the window, which isn't a Node, so check before asking contains().
    const inside = (target: EventTarget | null, element: HTMLElement | null) => target instanceof Node && Boolean(element?.contains(target));
    const close = (event: Event) => {
      if (inside(event.target, listRef.current) || inside(event.target, buttonRef.current)) return;
      setOpen(false);
    };
    const dismiss = (event: Event) => { if (!inside(event.target, listRef.current)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    return () => {
      document.removeEventListener("pointerdown", close);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, [open]);

  // Keep the active option visible by scrolling only the list; scrollIntoView could also scroll the page, which closes the list.
  useEffect(() => {
    const list = listRef.current;
    const item = list?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (!open || !list || !item) return;
    if (item.offsetTop < list.scrollTop) list.scrollTop = item.offsetTop;
    else if (item.offsetTop + item.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = item.offsetTop + item.offsetHeight - list.clientHeight;
  }, [active, open]);

  const choose = (index: number) => {
    const option = options[index];
    if (option) onChange(option.value);
    setOpen(false);
    buttonRef.current?.focus();
  };

  const onListKey = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.key === "ArrowDown") { event.preventDefault(); setActive((index) => Math.min(options.length - 1, index + 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive((index) => Math.max(0, index - 1)); }
    else if (event.key === "Home") { event.preventDefault(); setActive(0); }
    else if (event.key === "End") { event.preventDefault(); setActive(options.length - 1); }
    else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(active); }
    else if (event.key === "Escape") { event.preventDefault(); setOpen(false); buttonRef.current?.focus(); }
    else if (event.key === "Tab") setOpen(false);
    else if (event.key.length === 1 && /\S/.test(event.key)) {
      // Type-ahead: jump to the next option starting with the typed letter.
      const letter = event.key.toLowerCase();
      const order = [...options.keys()].map((offset) => (active + 1 + offset) % options.length);
      const match = order.find((index) => options[index].label.toLowerCase().startsWith(letter));
      if (match !== undefined) setActive(match);
    }
  };

  return <>
    <button
      ref={buttonRef}
      type="button"
      className="swatch-select-button"
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={open ? listId : undefined}
      aria-label={`${label}: ${current?.label ?? ""}`}
      onClick={() => setOpen((isOpen) => !isOpen)}
      onKeyDown={(event) => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); } }}
    >
      <i className="color-swatch" aria-hidden="true" style={current?.background} />
      <span className="swatch-select-text">{current?.label}</span>
      <ChevronDown size={14} aria-hidden="true" />
    </button>
    {open && position && createPortal(
      <ul
        ref={listRef}
        id={listId}
        role="listbox"
        tabIndex={-1}
        aria-label={label}
        aria-activedescendant={`${listId}-${active}`}
        className="swatch-select-list"
        style={{ left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight }}
        onKeyDown={onListKey}
      >
        {options.map((option, index) => (
          <li
            key={option.value}
            id={`${listId}-${index}`}
            data-index={index}
            role="option"
            aria-selected={index === selectedIndex}
            className={`${index === active ? "active" : ""} ${index === selectedIndex ? "selected" : ""}`}
            onPointerEnter={() => setActive(index)}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => choose(index)}
          >
            <i className="color-swatch" aria-hidden="true" style={option.background} />
            <span>{option.label}</span>
            {index === selectedIndex && <Check size={14} aria-hidden="true" />}
          </li>
        ))}
      </ul>,
      document.body,
    )}
  </>;
}

/**
 * Pick a finish for each of a product's color groups (e.g. POÄNG's cover and frame) from the
 * retailer's listed options. Imported products without known options get the listed color or a custom color;
 * groups marked allowCustom (the room's own bed) list their options plus a custom color.
 */
export function ColorChoicePicker({ product, selection, onChange, compact = false }: { product: Product; selection: Selection; onChange: (selection: Selection) => void; compact?: boolean }) {
  const known = colorGroupsFor(product);
  const groups: ColorGroup[] = known.length ? known : [{ id: "color", label: "Color", defaultName: product.variant || "Listed color", options: [] }];

  const update = (groupId: string, value: string | undefined) => {
    const next = { ...(selection ?? {}) };
    if (value === undefined) delete next[groupId];
    else next[groupId] = value;
    onChange(Object.keys(next).length ? next : undefined);
  };

  return <div className={`color-picker ${compact ? "compact" : ""}`}>
    {groups.map((group) => {
      const value = selection?.[group.id];
      const count = group.options.length;
      // Retailer products (the shortlist) offer only their listed colors; custom colors are for imported products and the room's own bed.
      const allowCustom = count === 0 || Boolean(group.allowCustom);
      const custom = allowCustom && isCustomColor(value);
      const choice = count ? selectedChoice(group, value) : null;
      const primary = custom ? value : choice?.hex ?? "#c9c6cf";
      const customOption: SwatchOption = { value: CUSTOM, label: custom ? `Custom color (${value})` : "Custom color…", background: custom ? swatchStyle(value) : { background: CUSTOM_SWATCH } };
      const options: SwatchOption[] = count
        ? [...group.options.map((option) => ({ value: option.name, label: option.name, background: swatchStyle(option.hex, option.secondary) })), ...(allowCustom ? [customOption] : [])]
        : [{ value: LISTED, label: group.defaultName, background: { background: "#c9c6cf" } }, customOption];
      return <div className="color-picker-group" key={group.id}>
        <span className="color-picker-label">{group.label}{count > 1 ? <small> · {count} options</small> : null}</span>
        <span className="color-picker-row">
          <SwatchSelect
            label={`${group.label} for ${product.name}`}
            options={options}
            value={custom ? CUSTOM : choice?.name ?? LISTED}
            onChange={(picked) => {
              if (picked === CUSTOM) update(group.id, custom ? value : primary.startsWith("#") && primary.length === 7 ? primary : "#888888");
              else if (picked === LISTED) update(group.id, undefined);
              else update(group.id, picked);
            }}
          />
          {custom && <input type="color" value={value} onChange={(event) => update(group.id, event.target.value)} aria-label={`Custom ${group.label.toLowerCase()} color for ${product.name}`} />}
        </span>
      </div>;
    })}
  </div>;
}
