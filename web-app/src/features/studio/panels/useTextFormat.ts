import { useCallback, useMemo } from 'react';
import type { EditorElement } from '../../../types/pdfEditor';
import type { StudioApi } from '../useStudio';
import { findFont, nearestWeight } from '../fonts';
import { TEXT_STYLE_PRESETS, type TextStylePreset } from '../textStyle';

/**
 * Single source of truth for every Word-style text command, shared by the ribbon and the
 * floating selection toolbar so both always report and apply exactly the same state.
 */
export const useTextFormat = (api: StudioApi) => {
  const { primary, selected, updateSelected, textDefaults, setTextDefaults } = api;
  /** Nothing selected → the commands edit the insertion-point defaults, like Word with the caret on an empty page. */
  const usingDefaults = selected.length === 0;
  const defaultsEl = useMemo(() => ({ ...textDefaults, type: 'text', id: '__text-defaults__' }) as EditorElement, [textDefaults]);
  const target = usingDefaults ? defaultsEl : primary;
  const apply = usingDefaults ? setTextDefaults : updateSelected;
  const isText = target?.type === 'text';
  const italic = Boolean(target?.fontStyle?.includes('italic'));
  const weight = target?.fontWeight ?? (target?.fontStyle?.includes('bold') ? 700 : 400);
  const bold = weight >= 600;
  const deco = target?.textDecoration || 'none';
  const family = target?.fontFamily || 'Helvetica';
  const fontDef = target?.fontFamily ? findFont(target.fontFamily) : undefined;
  const fontSize = target?.fontSize || 16;
  const align = target?.align || 'left';
  const listStyle = target?.listStyle || 'none';
  const script = target?.textScript || 'none';
  const canItalic = fontDef ? fontDef.italic : true;

  const styleOf = (w: number, it: boolean) => ((w >= 600 && it ? 'bold italic' : w >= 600 ? 'bold' : it ? 'italic' : 'normal') as EditorElement['fontStyle']);

  const setWeight = useCallback((w: number) => apply({ fontWeight: w, fontStyle: styleOf(w, italic) }), [apply, italic]);
  const toggleBold = useCallback(() => setWeight(bold ? 400 : 700), [setWeight, bold]);
  const setItalic = useCallback((i: boolean) => apply({ fontStyle: styleOf(weight, i) }), [apply, weight]);
  const toggleItalic = useCallback(() => setItalic(!italic), [setItalic, italic]);

  const toggleDeco = useCallback(
    (d: 'underline' | 'line-through') => {
      const parts = deco.split(' ').filter((x) => x && x !== 'none' && x !== d);
      if (!deco.includes(d)) parts.push(d);
      apply({ textDecoration: (parts.join(' ') || 'none') as EditorElement['textDecoration'] });
    },
    [deco, apply]
  );

  const setFamily = useCallback((f: string) => apply({ fontFamily: f, fontWeight: nearestWeight(f, weight) }), [apply, weight]);
  const setFontSize = useCallback(
    (s: number) => {
      if (!Number.isFinite(s) || s <= 0) return;
      apply({ fontSize: Math.max(2, Math.min(400, s)) });
    },
    [apply]
  );

  const cycleCase = useCallback(() => {
    const order: NonNullable<EditorElement['textTransform']>[] = ['none', 'uppercase', 'lowercase', 'capitalize'];
    const cur = target?.textTransform || 'none';
    apply({ textTransform: order[(order.indexOf(cur) + 1) % order.length] });
  }, [target?.textTransform, apply]);
  const setCase = useCallback((t: NonNullable<EditorElement['textTransform']>) => apply({ textTransform: t }), [apply]);

  const setScript = useCallback(
    (s: 'super' | 'sub') => apply((el) => ({ textScript: el.textScript === s ? 'none' : s })),
    [apply]
  );

  const setList = useCallback(
    (s: 'bullet' | 'number') => apply((el) => ({ listStyle: el.listStyle === s ? 'none' : s })),
    [apply]
  );

  const indent = useCallback((delta: number) => apply((el) => ({ indent: Math.max(0, Math.min(240, (el.indent || 0) + delta)) })), [apply]);

  const setAlign = useCallback((a: NonNullable<EditorElement['align']>) => apply({ align: a }), [apply]);
  const setLineHeight = useCallback((v: number) => apply({ lineHeight: v }), [apply]);
  const setSpacing = useCallback((patch: { before?: number; after?: number }) => apply((el) => ({ spaceBefore: patch.before ?? el.spaceBefore ?? 0, spaceAfter: patch.after ?? el.spaceAfter ?? 0 })), [apply]);

  const setFill = useCallback((v: string) => apply({ fill: v }), [apply]);
  const setHighlight = useCallback((v: string) => apply({ backgroundColor: v }), [apply]);
  const setBorder = useCallback((patch: Partial<EditorElement>) => apply(patch), [apply]);

  const applyStyle = useCallback((preset: TextStylePreset) => apply(preset.patch), [apply]);

  /** Which gallery entry matches the current selection (font size + weight are enough to disambiguate). */
  const activeStyleId = useMemo(() => {
    if (!target || target.type !== 'text') return null;
    return TEXT_STYLE_PRESETS.find((p) => p.patch.fontSize === target.fontSize && (p.patch.fontWeight ?? 400) === (target.fontWeight ?? 400) && (p.patch.fontStyle ?? 'normal') === (target.fontStyle ?? 'normal'))?.id ?? null;
  }, [target]);

  return {
    primary,
    selected,
    isText,
    usingDefaults,
    hasSelection: selected.length > 0,
    bold,
    italic,
    canItalic,
    weight,
    deco,
    family,
    fontDef,
    fontSize,
    align,
    listStyle,
    script,
    activeStyleId,
    setWeight,
    toggleBold,
    toggleItalic,
    toggleDeco,
    setFamily,
    setFontSize,
    cycleCase,
    setCase,
    setScript,
    setList,
    indent,
    setAlign,
    setLineHeight,
    setSpacing,
    setFill,
    setHighlight,
    setBorder,
    applyStyle
  };
};

export type TextFormatApi = ReturnType<typeof useTextFormat>;
