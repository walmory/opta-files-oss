import { useCallback, useRef, useState } from 'react';
import {
  ClipboardPaste,
  Copy,
  Scissors,
  Paintbrush,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Subscript,
  Superscript,
  CaseSensitive,
  Eraser,
  List,
  ListOrdered,
  IndentDecrease,
  IndentIncrease,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  ChevronDown,
  ChevronUp,
  Baseline,
  Highlighter,
  PaintBucket,
  SquareDashedBottom,
  Type,
  Image as ImageIcon,
  Shapes,
  Square,
  Circle,
  Minus,
  MoveRight,
  LayoutTemplate,
  Sticker,
  FilePlus2,
  CopyPlus,
  Trash2,
  PenTool,
  Hand,
  MousePointer2,
  Ruler,
  Frame,
  Palette,
  ZoomIn,
  ZoomOut,
  Scaling,
  Expand,
  PanelLeft,
  PanelRight,
  RotateCcw,
  RotateCw,
  BringToFront,
  SendToBack,
  Rows3
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn, Tooltip } from '../../../components/ui';
import type { StudioApi, StudioTool } from '../useStudio';
import { STUDIO_ICONS } from '../icons';
import { FONT_SIZE_PRESETS } from '../fonts';
import { TEXT_STYLE_PRESETS } from '../textStyle';
import { PAGE_SIZES, MARGIN_PRESETS } from '../../../types/pdfEditor';
import FontPicker from './FontPicker';
import ColorSplitButton from './ColorSplitButton';
import { HIGHLIGHT_COLORS } from './colors';
import { useTextFormat } from './useTextFormat';
import Anchored from './Anchored';

export type DrawerPanel = 'templates' | 'icons' | 'background' | null;
export type RibbonTab = 'home' | 'insert' | 'draw' | 'layout' | 'view';

const TABS: { id: RibbonTab }[] = [{ id: 'home' }, { id: 'insert' }, { id: 'draw' }, { id: 'layout' }, { id: 'view' }];

/* ---------------------------------------------------------------- primitives */

const Group = ({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) => (
  <div className={cn('h-full flex flex-col items-center justify-between px-2 shrink-0', className)}>
    <div className="flex-1 flex items-center gap-1">{children}</div>
    <span className="text-[9px] leading-none text-slate-400 pb-1 select-none">{label}</span>
  </div>
);

const Sep = () => <div className="w-px h-[52px] bg-slate-200 self-center shrink-0" />;

const Btn = ({ icon: Icon, label, onClick, active, disabled, danger }: { icon: typeof Bold; label: string; onClick: () => void; active?: boolean; disabled?: boolean; danger?: boolean }) => (
  <Tooltip label={label}>
    <button
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        'h-[26px] w-[26px] rounded-md flex items-center justify-center transition-colors disabled:opacity-30 disabled:pointer-events-none',
        active ? 'bg-brand-100 text-brand-800 ring-1 ring-brand-300' : danger ? 'text-rose-600 hover:bg-rose-50' : 'text-slate-700 hover:bg-slate-200/70'
      )}
    >
      <Icon className="w-[15px] h-[15px]" />
    </button>
  </Tooltip>
);

const BigBtn = ({ icon: Icon, label, onClick, active, disabled, caption }: { icon: typeof Bold; label: string; onClick: () => void; active?: boolean; disabled?: boolean; caption?: string }) => (
  <Tooltip label={caption || label}>
    <button
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        'h-[54px] min-w-[54px] px-1.5 rounded-md flex flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors disabled:opacity-30 disabled:pointer-events-none',
        active ? 'bg-brand-100 text-brand-800 ring-1 ring-brand-300' : 'text-slate-700 hover:bg-slate-200/70'
      )}
    >
      <Icon className="w-[22px] h-[22px]" />
      <span className="leading-none whitespace-nowrap">{label}</span>
    </button>
  </Tooltip>
);

/** Small dropdown anchored under its trigger; portalled so the scrolling ribbon can't clip it. */
const Menu = ({ trigger, children, width = 220, align = 'left' }: { trigger: (open: boolean, toggle: () => void) => React.ReactNode; children: (close: () => void) => React.ReactNode; width?: number; align?: 'left' | 'right' }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  return (
    <div ref={ref} className="relative">
      {trigger(open, () => setOpen((v) => !v))}
      <Anchored anchor={ref} open={open} onClose={close} width={width} align={align} className="py-1">
        {children(close)}
      </Anchored>
    </div>
  );
};

const MenuItem = ({ children, onClick, active }: { children: React.ReactNode; onClick: () => void; active?: boolean }) => (
  <button onClick={onClick} className={cn('w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 flex items-center gap-2', active ? 'font-bold text-brand-700 bg-brand-50/60' : 'text-slate-700')}>
    {children}
  </button>
);

/** Editable font-size combo (type a value or pick from the Word ladder). */
const FontSizeBox = ({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled?: boolean }) => {
  const [draft, setDraft] = useState(String(Math.round(value * 10) / 10));
  const commit = () => {
    const n = Number(draft.replace(',', '.'));
    if (Number.isFinite(n) && n > 0) onChange(n);
    else setDraft(String(Math.round(value * 10) / 10));
  };
  return (
    <Menu
      width={78}
      trigger={(open, toggle) => (
        <div className={cn('h-[26px] w-[62px] rounded-md border border-slate-300 bg-white flex items-center overflow-hidden', disabled && 'opacity-40 pointer-events-none', open && 'border-brand-400')}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') {
                commit();
                (e.target as HTMLInputElement).blur();
              }
            }}
            className="flex-1 min-w-0 h-full px-1.5 text-[11px] font-semibold outline-none"
            title="Tamanho da fonte"
          />
          <button onClick={toggle} className="h-full w-4 flex items-center justify-center text-slate-400 hover:bg-slate-100">
            <ChevronDown className="w-3 h-3" />
          </button>
        </div>
      )}
    >
      {(close) => (
        <div className="max-h-[260px] overflow-y-auto custom-scrollbar">
          {FONT_SIZE_PRESETS.map((s) => (
            <MenuItem
              key={s}
              active={Math.abs(s - value) < 0.01}
              onClick={() => {
                onChange(s);
                close();
              }}
            >
              {s}
            </MenuItem>
          ))}
        </div>
      )}
    </Menu>
  );
};

/* ---------------------------------------------------------------- ribbon */

interface Props {
  api: StudioApi;
  drawer: DrawerPanel;
  setDrawer: (d: DrawerPanel) => void;
  onInsertImage: () => void;
  onZoom: (factor: number) => void;
  onFitWidth: () => void;
  onFitPage: () => void;
  showPages: boolean;
  showProps: boolean;
  onTogglePages: () => void;
  onToggleProps: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

const LINE_SPACINGS = [1, 1.15, 1.5, 2, 2.5, 3];

const Ribbon = ({ api, drawer, setDrawer, onInsertImage, onZoom, onFitWidth, onFitPage, showPages, showProps, onTogglePages, onToggleProps, collapsed, onToggleCollapsed }: Props) => {
  const { t } = useTranslation('studio');
  const [tab, setTab] = useState<RibbonTab>('home');
  const { tool, setTool, addElement, page, updatePage, copy, cut, paste, primary, selected, deleteSelected, duplicateSelected, addPage, duplicatePage, deletePage, showRulers, setShowRulers, showMargins, setShowMargins, bumpFontSize, clearFormat, formatBrush, setFormatBrush, copyFormat, updateSelected, reorder, doc } = api;
  const f = useTextFormat(api);
  const noText = !f.isText;

  const pickTool = (t: StudioTool) => setTool(tool === t ? 'select' : t);

  const addShape = (kind: 'rect' | 'rounded' | 'circle' | 'line' | 'arrow') => {
    if (kind === 'rect' || kind === 'rounded') addElement({ type: 'rect', x: NaN, y: NaN, width: 200, height: 120, content: '', fill: '#1b3f8b', cornerRadius: kind === 'rounded' ? 16 : 0, name: kind === 'rounded' ? 'Retângulo arredondado' : 'Retângulo' });
    else if (kind === 'circle') addElement({ type: 'circle', x: NaN, y: NaN, width: 140, height: 140, content: '', fill: '#2e8b3d', name: 'Círculo' });
    else if (kind === 'line') addElement({ type: 'line', x: NaN, y: NaN, width: 220, height: 0, content: '', points: [0, 0, 220, 0], stroke: '#0f172a', strokeWidth: 3, name: 'Linha' });
    else addElement({ type: 'arrow', x: NaN, y: NaN, width: 220, height: 0, content: '', points: [0, 0, 220, 0], stroke: '#0f172a', strokeWidth: 3, fill: '#0f172a', name: 'Seta' });
  };

  const addTextBox = () => api.addTextAt({ x: NaN, y: NaN }, 'Novo texto');

  const rotateSel = (delta: number) => updateSelected((el) => ({ rotation: ((((el.rotation || 0) + delta) % 360) + 360) % 360 }));

  return (
    <div className="bg-[#f6f7f9] border-b border-slate-200 shrink-0">
      {/* tab strip */}
      <div className="h-8 flex items-end px-2 border-b border-slate-200 bg-white">
        <div className="flex-1 min-w-0 flex items-end gap-0.5 overflow-x-auto scrollbar-hide">
          {TABS.map((tb) => (
            <button
              key={tb.id}
              onClick={() => {
                if (collapsed) onToggleCollapsed();
                setTab(tb.id);
              }}
              className={cn('h-7 px-3 shrink-0 whitespace-nowrap rounded-t-md text-[12px] font-semibold transition-colors', tab === tb.id && !collapsed ? 'bg-[#f6f7f9] text-brand-800 border-x border-t border-slate-200 -mb-px' : 'text-slate-600 hover:bg-slate-100')}
            >
              {t(`ribbon.tabs.${tb.id}`)}
            </button>
          ))}
        </div>
        <div className="shrink-0 flex items-center gap-1 pb-0.5 pl-1">
          {formatBrush && (
            <button onClick={() => setFormatBrush(null)} className="h-6 px-2 rounded-md bg-amber-100 text-amber-800 text-[10px] font-bold flex items-center gap-1">
              <Paintbrush className="w-3 h-3" /> {t('ribbon.formatBrushActive')}
            </button>
          )}
          {/* side="left": at the right edge of the ribbon a top/centered tooltip
              overflows the viewport and makes the whole studio scroll sideways */}
          <Tooltip side="left" label={collapsed ? t('ribbon.showRibbon') : t('ribbon.hideRibbon')}>
            <button onClick={onToggleCollapsed} className="h-6 w-6 rounded-md text-slate-500 hover:bg-slate-100 flex items-center justify-center">
              {collapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
            </button>
          </Tooltip>
        </div>
      </div>

      {!collapsed && (
        <div
          className="h-[76px] flex items-stretch overflow-x-auto overflow-y-hidden overscroll-x-contain scrollbar-hide"
          onWheel={(e) => {
            // vertical wheel scrolls the ribbon horizontally (Word-like), so the
            // groups that overflow on narrow windows stay reachable
            if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY;
          }}
        >
          {tab === 'home' && (
            <>
              <Group label={t('ribbon.groups.clipboard')}>
                <BigBtn icon={ClipboardPaste} label={t('ribbon.paste.label')} caption={t('ribbon.paste.caption')} onClick={paste} />
                <BigBtn icon={Type} label={t('ribbon.textBox.label')} caption={t('ribbon.textBox.caption')} onClick={addTextBox} />
                <div className="flex flex-col gap-0.5">
                  <Btn icon={Scissors} label={t('ribbon.cut')} onClick={cut} disabled={!selected.length} />
                  <Btn icon={Copy} label={t('ribbon.copy')} onClick={copy} disabled={!selected.length} />
                  <Btn
                    icon={Paintbrush}
                    label={t('ribbon.formatBrush')}
                    active={Boolean(formatBrush)}
                    disabled={!primary}
                    onClick={() => (formatBrush ? setFormatBrush(null) : copyFormat(false))}
                  />
                </div>
              </Group>
              <Sep />

              <Group label={f.usingDefaults ? t('ribbon.groups.fontNextText') : t('ribbon.groups.font')}>
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-1">
                    <FontPicker value={f.family} onChange={f.setFamily} className={cn(noText && 'opacity-40 pointer-events-none')} />
                    <FontSizeBox key={f.fontSize} value={f.fontSize} onChange={f.setFontSize} disabled={noText} />
                    <Btn icon={ChevronUp} label={t('ribbon.increaseFontSize')} onClick={() => bumpFontSize(1)} disabled={noText} />
                    <Btn icon={ChevronDown} label={t('ribbon.decreaseFontSize')} onClick={() => bumpFontSize(-1)} disabled={noText} />
                    <Menu
                      width={190}
                      trigger={(open, toggle) => (
                        <button onClick={toggle} disabled={noText} className={cn('h-[26px] px-1.5 rounded-md flex items-center gap-0.5 text-slate-700 hover:bg-slate-200/70 disabled:opacity-30', open && 'bg-slate-200/70')} title={t('ribbon.caseTitle')}>
                          <CaseSensitive className="w-[17px] h-[17px]" />
                          <ChevronDown className="w-3 h-3 text-slate-400" />
                        </button>
                      )}
                    >
                      {(close) => (
                        <>
                          {([
                            ['none', t('ribbon.case.none')],
                            ['uppercase', t('ribbon.case.uppercase')],
                            ['lowercase', t('ribbon.case.lowercase')],
                            ['capitalize', t('ribbon.case.capitalize')]
                          ] as const).map(([id, lbl]) => (
                            <MenuItem
                              key={id}
                              active={(primary?.textTransform || 'none') === id}
                              onClick={() => {
                                f.setCase(id);
                                close();
                              }}
                            >
                              {lbl}
                            </MenuItem>
                          ))}
                        </>
                      )}
                    </Menu>
                    <Btn icon={Eraser} label={t('ribbon.clearFormat')} onClick={clearFormat} disabled={!primary} />
                  </div>
                  <div className="flex items-center gap-1">
                    <Btn icon={Bold} label={t('ribbon.bold')} onClick={f.toggleBold} active={f.bold} disabled={noText} />
                    <Btn icon={Italic} label={t('ribbon.italic')} onClick={f.toggleItalic} active={f.italic} disabled={noText || !f.canItalic} />
                    <Btn icon={Underline} label={t('ribbon.underline')} onClick={() => f.toggleDeco('underline')} active={f.deco.includes('underline')} disabled={noText} />
                    <Btn icon={Strikethrough} label={t('ribbon.strikethrough')} onClick={() => f.toggleDeco('line-through')} active={f.deco.includes('line-through')} disabled={noText} />
                    <Btn icon={Subscript} label={t('ribbon.subscript')} onClick={() => f.setScript('sub')} active={f.script === 'sub'} disabled={noText} />
                    <Btn icon={Superscript} label={t('ribbon.superscript')} onClick={() => f.setScript('super')} active={f.script === 'super'} disabled={noText} />
                    <div className={cn('flex items-center gap-1', noText && 'opacity-40 pointer-events-none')}>
                      <ColorSplitButton icon={<Highlighter className="w-[14px] h-[14px]" />} label={t('ribbon.highlightColor')} value={primary?.backgroundColor} onChange={f.setHighlight} swatches={HIGHLIGHT_COLORS} allowTransparent transparentLabel={t('ribbon.noHighlight')} fallbackBar="#fef08a" />
                      <ColorSplitButton icon={<Baseline className="w-[14px] h-[14px]" />} label={t('ribbon.fontColor')} value={primary?.fill} onChange={f.setFill} fallbackBar="#c00000" />
                    </div>
                  </div>
                </div>
              </Group>
              <Sep />

              <Group label={f.usingDefaults ? t('ribbon.groups.paragraphNextText') : t('ribbon.groups.paragraph')}>
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-1">
                    <Btn icon={List} label={t('ribbon.bullets')} onClick={() => f.setList('bullet')} active={f.listStyle === 'bullet'} disabled={noText} />
                    <Btn icon={ListOrdered} label={t('ribbon.numbering')} onClick={() => f.setList('number')} active={f.listStyle === 'number'} disabled={noText} />
                    <Btn icon={IndentDecrease} label={t('ribbon.decreaseIndent')} onClick={() => f.indent(-24)} disabled={noText} />
                    <Btn icon={IndentIncrease} label={t('ribbon.increaseIndent')} onClick={() => f.indent(24)} disabled={noText} />
                    <Menu
                      width={200}
                      trigger={(open, toggle) => (
                        <button onClick={toggle} disabled={noText} className={cn('h-[26px] px-1.5 rounded-md flex items-center gap-0.5 text-slate-700 hover:bg-slate-200/70 disabled:opacity-30', open && 'bg-slate-200/70')} title={t('ribbon.lineSpacingTitle')}>
                          <Rows3 className="w-[15px] h-[15px]" />
                          <ChevronDown className="w-3 h-3 text-slate-400" />
                        </button>
                      )}
                    >
                      {(close) => (
                        <>
                          {LINE_SPACINGS.map((s) => (
                            <MenuItem
                              key={s}
                              active={Math.abs((primary?.lineHeight || 1.25) - s) < 0.01}
                              onClick={() => {
                                f.setLineHeight(s);
                                close();
                              }}
                            >
                              {s.toFixed(2).replace('.', ',')}
                            </MenuItem>
                          ))}
                          <div className="h-px bg-slate-100 my-1" />
                          <MenuItem
                            onClick={() => {
                              f.setSpacing({ before: (primary?.spaceBefore || 0) + 6 });
                              close();
                            }}
                          >
                            {t('ribbon.addSpaceBefore')}
                          </MenuItem>
                          <MenuItem
                            onClick={() => {
                              f.setSpacing({ after: (primary?.spaceAfter || 0) + 6 });
                              close();
                            }}
                          >
                            {t('ribbon.addSpaceAfter')}
                          </MenuItem>
                          <MenuItem
                            onClick={() => {
                              f.setSpacing({ before: 0, after: 0 });
                              close();
                            }}
                          >
                            {t('ribbon.removeSpacing')}
                          </MenuItem>
                        </>
                      )}
                    </Menu>
                  </div>
                  <div className="flex items-center gap-1">
                    <Btn icon={AlignLeft} label={t('ribbon.alignLeft')} onClick={() => f.setAlign('left')} active={f.align === 'left'} disabled={noText} />
                    <Btn icon={AlignCenter} label={t('ribbon.alignCenter')} onClick={() => f.setAlign('center')} active={f.align === 'center'} disabled={noText} />
                    <Btn icon={AlignRight} label={t('ribbon.alignRight')} onClick={() => f.setAlign('right')} active={f.align === 'right'} disabled={noText} />
                    <Btn icon={AlignJustify} label={t('ribbon.alignJustify')} onClick={() => f.setAlign('justify')} active={f.align === 'justify'} disabled={noText} />
                    <div className={cn('flex items-center gap-1', !primary && 'opacity-40 pointer-events-none')}>
                      <ColorSplitButton icon={<PaintBucket className="w-[14px] h-[14px]" />} label={t('ribbon.shading')} value={f.isText ? primary?.backgroundColor : primary?.fill} onChange={(v) => (f.isText ? f.setHighlight(v) : updateSelected({ fill: v }))} allowTransparent transparentLabel={t('ribbon.noFill')} fallbackBar="#e2e8f0" />
                      <Menu
                        width={210}
                        trigger={(open, toggle) => (
                          <button onClick={toggle} disabled={!primary} className={cn('h-[26px] px-1.5 rounded-md flex items-center gap-0.5 text-slate-700 hover:bg-slate-200/70 disabled:opacity-30', open && 'bg-slate-200/70')} title={t('ribbon.bordersTitle')}>
                            <SquareDashedBottom className="w-[15px] h-[15px]" />
                            <ChevronDown className="w-3 h-3 text-slate-400" />
                          </button>
                        )}
                      >
                        {(close) => (
                          <>
                            <MenuItem
                              onClick={() => {
                                f.setBorder({ stroke: 'transparent', strokeWidth: 0 });
                                close();
                              }}
                            >
                              {t('ribbon.noBorder')}
                            </MenuItem>
                            {[0.5, 1, 1.5, 2, 3].map((w) => (
                              <MenuItem
                                key={w}
                                active={(primary?.strokeWidth || 0) === w}
                                onClick={() => {
                                  f.setBorder({ stroke: primary?.stroke && primary.stroke !== 'transparent' ? primary.stroke : '#0f172a', strokeWidth: w });
                                  close();
                                }}
                              >
                                {t('ribbon.borderWidth', { width: String(w).replace('.', ',') })}
                              </MenuItem>
                            ))}
                            <div className="h-px bg-slate-100 my-1" />
                            <div className="px-3 py-1.5 flex items-center gap-2">
                              <span className="text-[11px] text-slate-500">{t('ribbon.color')}</span>
                              <input type="color" value={primary?.stroke && primary.stroke !== 'transparent' ? primary.stroke : '#0f172a'} onChange={(e) => f.setBorder({ stroke: e.target.value, strokeWidth: primary?.strokeWidth || 1 })} className="h-6 w-9 rounded-md border border-slate-200 p-0.5 cursor-pointer" />
                            </div>
                          </>
                        )}
                      </Menu>
                    </div>
                  </div>
                </div>
              </Group>
              <Sep />

              <Group label={t('ribbon.groups.styles')} className="min-w-0">
                <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide max-w-[46vw] pr-1">
                  {TEXT_STYLE_PRESETS.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => f.applyStyle(s)}
                      disabled={noText}
                      title={s.label}
                      className={cn('h-[54px] w-[72px] shrink-0 rounded-md border bg-white flex flex-col items-center justify-center gap-1 px-1 transition-colors disabled:opacity-40 disabled:pointer-events-none', f.activeStyleId === s.id ? 'border-brand-500 ring-1 ring-brand-300' : 'border-slate-200 hover:border-slate-400')}
                    >
                      <span
                        className="truncate max-w-full leading-none"
                        style={{
                          fontSize: Math.min(15, Math.max(9, (s.patch.fontSize || 12) * 0.62)),
                          fontWeight: s.patch.fontWeight || 400,
                          fontStyle: s.patch.fontStyle?.includes('italic') ? 'italic' : 'normal',
                          color: s.patch.fill || '#0f172a'
                        }}
                      >
                        {s.preview}
                      </span>
                      <span className="text-[9px] text-slate-500 leading-none truncate max-w-full">{s.label}</span>
                    </button>
                  ))}
                </div>
              </Group>
              <Sep />

              <Group label={t('ribbon.groups.edit')}>
                <Btn icon={BringToFront} label={t('ribbon.bringToFront')} onClick={() => reorder('front')} disabled={!primary} />
                <Btn icon={SendToBack} label={t('ribbon.sendToBack')} onClick={() => reorder('back')} disabled={!primary} />
                <Btn icon={RotateCcw} label={t('ribbon.rotateCcw')} onClick={() => rotateSel(-90)} disabled={!primary} />
                <Btn icon={RotateCw} label={t('ribbon.rotateCw')} onClick={() => rotateSel(90)} disabled={!primary} />
                <Btn icon={CopyPlus} label={t('ribbon.duplicate')} onClick={duplicateSelected} disabled={!primary} />
                <Btn icon={Trash2} label={t('ribbon.delete')} onClick={deleteSelected} disabled={!primary} danger />
              </Group>
            </>
          )}

          {tab === 'insert' && (
            <>
              <Group label={t('ribbon.groups.pages')}>
                <BigBtn icon={FilePlus2} label={t('ribbon.newPage.label')} caption={t('ribbon.newPage.caption')} onClick={() => addPage()} />
                <BigBtn icon={CopyPlus} label={t('ribbon.duplicatePage.label')} caption={t('ribbon.duplicatePage.caption')} onClick={duplicatePage} />
                <BigBtn icon={Trash2} label={t('ribbon.deletePage.label')} caption={t('ribbon.deletePage.caption')} onClick={() => deletePage()} disabled={doc.pages.length <= 1} />
              </Group>
              <Sep />
              <Group label={t('ribbon.groups.text')}>
                <BigBtn icon={Type} label={t('ribbon.textBoxInsert.label')} caption={t('ribbon.textBoxInsert.caption')} onClick={addTextBox} />
                <BigBtn icon={Type} label={t('ribbon.writeText.label')} caption={t('ribbon.writeText.caption')} onClick={() => pickTool('text')} active={tool === 'text'} />
              </Group>
              <Sep />
              <Group label={t('ribbon.groups.illustrations')}>
                <BigBtn icon={ImageIcon} label={t('ribbon.image.label')} caption={t('ribbon.image.caption')} onClick={onInsertImage} />
                <Menu
                  width={236}
                  trigger={(open, toggle) => (
                    <button onClick={toggle} className={cn('h-[54px] min-w-[54px] px-1.5 rounded-md flex flex-col items-center justify-center gap-1 text-[10px] font-medium text-slate-700 hover:bg-slate-200/70', open && 'bg-slate-200/70')}>
                      <Shapes className="w-[22px] h-[22px]" />
                      <span className="leading-none">{t('ribbon.shapesMenu')}</span>
                    </button>
                  )}
                >
                  {(close) => (
                    <div className="p-2">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-1 mb-1">{t('ribbon.insertCenter')}</p>
                      <div className="grid grid-cols-5 gap-1">
                        {[
                          { k: 'rect', icon: Square, label: t('ribbon.shapeNames.rect') },
                          { k: 'rounded', icon: Square, label: t('ribbon.shapeNames.rounded') },
                          { k: 'circle', icon: Circle, label: t('ribbon.shapeNames.circle') },
                          { k: 'line', icon: Minus, label: t('ribbon.shapeNames.line') },
                          { k: 'arrow', icon: MoveRight, label: t('ribbon.shapeNames.arrow') }
                        ].map((s) => (
                          <button
                            key={s.k}
                            title={s.label}
                            onClick={() => {
                              addShape(s.k as 'rect');
                              close();
                            }}
                            className="h-10 rounded-lg bg-slate-100 hover:bg-brand-50 hover:text-brand-700 flex items-center justify-center text-slate-600"
                          >
                            <s.icon className={cn('w-5 h-5', s.k === 'rounded' && 'rounded-md')} />
                          </button>
                        ))}
                      </div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-1 mt-2 mb-1">{t('ribbon.drawOnPage')}</p>
                      <div className="grid grid-cols-4 gap-1">
                        {(['rect', 'circle', 'line', 'arrow'] as const).map((tl) => (
                          <button
                            key={tl}
                            onClick={() => {
                              pickTool(tl);
                              close();
                            }}
                            className={cn('h-8 rounded-lg text-[11px] font-semibold border', tool === tl ? 'bg-brand-600 border-brand-600 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50')}
                          >
                            {tl === 'rect' ? t('ribbon.shapeShort.rect') : tl === 'circle' ? t('ribbon.shapeShort.circle') : tl === 'line' ? t('ribbon.shapeShort.line') : t('ribbon.shapeShort.arrow')}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </Menu>
                <BigBtn icon={Sticker} label={t('ribbon.icons.label')} caption={t('ribbon.icons.caption', { count: STUDIO_ICONS.length })} onClick={() => setDrawer(drawer === 'icons' ? null : 'icons')} active={drawer === 'icons'} />
                <BigBtn icon={LayoutTemplate} label={t('ribbon.templates')} onClick={() => setDrawer(drawer === 'templates' ? null : 'templates')} active={drawer === 'templates'} />
              </Group>
            </>
          )}

          {tab === 'draw' && (
            <>
              <Group label="Ferramentas">
                <BigBtn icon={MousePointer2} label="Selecionar" caption="Selecionar (V)" onClick={() => setTool('select')} active={tool === 'select'} />
                <BigBtn icon={Hand} label="Mover" caption="Mover tela (H / Espaço)" onClick={() => pickTool('hand')} active={tool === 'hand'} />
              </Group>
              <Sep />
              <Group label="Canetas">
                <BigBtn icon={PenTool} label="Caneta" caption="Desenho livre" onClick={() => pickTool('pen')} active={tool === 'pen'} />
                <BigBtn icon={Highlighter} label="Realçar" caption="Arraste sobre o texto para realçar" onClick={() => pickTool('highlight')} active={tool === 'highlight'} />
                <BigBtn icon={Eraser} label="Cobrir" caption="Cobrir uma área com branco (whiteout)" onClick={() => pickTool('whiteout')} active={tool === 'whiteout'} />
              </Group>
              <Sep />
              <Group label="Formas">
                <BigBtn icon={Square} label="Retângulo" onClick={() => pickTool('rect')} active={tool === 'rect'} />
                <BigBtn icon={Circle} label="Elipse" onClick={() => pickTool('circle')} active={tool === 'circle'} />
                <BigBtn icon={Minus} label="Linha" onClick={() => pickTool('line')} active={tool === 'line'} />
                <BigBtn icon={MoveRight} label="Seta" onClick={() => pickTool('arrow')} active={tool === 'arrow'} />
              </Group>
            </>
          )}

          {tab === 'layout' && (
            <>
              <Group label="Configurar página">
                <Menu
                  width={210}
                  trigger={(open, toggle) => (
                    <button onClick={toggle} className={cn('h-[54px] min-w-[54px] px-1.5 rounded-md flex flex-col items-center justify-center gap-1 text-[10px] font-medium text-slate-700 hover:bg-slate-200/70', open && 'bg-slate-200/70')}>
                      <Frame className="w-[22px] h-[22px]" />
                      <span className="leading-none">Tamanho</span>
                    </button>
                  )}
                >
                  {(close) => (
                    <>
                      {PAGE_SIZES.map((s) => (
                        <MenuItem
                          key={s.id}
                          active={page?.width === s.width && page?.height === s.height}
                          onClick={() => {
                            updatePage({ width: s.width, height: s.height });
                            close();
                          }}
                        >
                          {s.label} <span className="ml-auto text-[10px] text-slate-400">{s.width}×{s.height}</span>
                        </MenuItem>
                      ))}
                    </>
                  )}
                </Menu>
                <Menu
                  width={220}
                  trigger={(open, toggle) => (
                    <button onClick={toggle} className={cn('h-[54px] min-w-[54px] px-1.5 rounded-md flex flex-col items-center justify-center gap-1 text-[10px] font-medium text-slate-700 hover:bg-slate-200/70', open && 'bg-slate-200/70')}>
                      <SquareDashedBottom className="w-[22px] h-[22px]" />
                      <span className="leading-none">Margens</span>
                    </button>
                  )}
                >
                  {(close) => (
                    <>
                      {MARGIN_PRESETS.map((m) => (
                        <MenuItem
                          key={m.id}
                          active={page?.margins?.top === m.margins.top && page?.margins?.left === m.margins.left}
                          onClick={() => {
                            updatePage({ margins: m.margins });
                            close();
                          }}
                        >
                          {m.label}
                        </MenuItem>
                      ))}
                    </>
                  )}
                </Menu>
                <BigBtn
                  icon={RotateCw}
                  label="Orientação"
                  caption="Alternar retrato/paisagem"
                  onClick={() => page && updatePage({ width: page.height, height: page.width })}
                  disabled={!page}
                />
              </Group>
              <Sep />
              <Group label="Fundo">
                <BigBtn icon={Palette} label="Página" caption="Cor de fundo, tamanho e margens" onClick={() => setDrawer(drawer === 'background' ? null : 'background')} active={drawer === 'background'} />
              </Group>
            </>
          )}

          {tab === 'view' && (
            <>
              <Group label="Mostrar">
                <BigBtn icon={Ruler} label="Réguas" onClick={() => setShowRulers(!showRulers)} active={showRulers} />
                <BigBtn icon={SquareDashedBottom} label="Margens" onClick={() => setShowMargins(!showMargins)} active={showMargins} />
              </Group>
              <Sep />
              <Group label="Zoom">
                <BigBtn icon={ZoomOut} label="Reduzir" caption="Diminuir zoom (⌘−)" onClick={() => onZoom(1 / 1.2)} />
                <BigBtn icon={ZoomIn} label="Ampliar" caption="Aumentar zoom (⌘+)" onClick={() => onZoom(1.2)} />
                <BigBtn icon={Scaling} label="Largura" caption="Ajustar à largura (⌘0)" onClick={onFitWidth} />
                <BigBtn icon={Expand} label="Página" caption="Página inteira" onClick={onFitPage} />
              </Group>
              <Sep />
              <Group label="Painéis">
                <BigBtn icon={PanelLeft} label="Páginas" onClick={onTogglePages} active={showPages} />
                <BigBtn icon={PanelRight} label="Propriedades" onClick={onToggleProps} active={showProps} />
              </Group>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default Ribbon;
