import type { DrawingInstruction } from '../../domain/analysis';
import { findActiveTradingViewChart } from './collect-context';

const SVG_NS = 'http://www.w3.org/2000/svg';
const OVERLAY_ID = 'chartviz-drawing-overlay';
let cleanupOverlay: (() => void) | undefined;

const COLORS: Record<DrawingInstruction['tool'], string> = {
  support_line: '#22c55e', resistance_line: '#ef4444', support_zone: '#22c55e',
  resistance_zone: '#ef4444', trend_line: '#60a5fa', breakout_marker: '#22c55e',
  rejection_marker: '#f59e0b', time_marker: '#a78bfa', entry_line: '#38bdf8',
  stop_line: '#f97316', target_line: '#c084fc', note: '#facc15',
};

function svgElement<K extends keyof SVGElementTagNameMap>(name: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, name);
}

function addLabel(svg: SVGSVGElement, x: number, y: number, text: string, color: string) {
  const label = svgElement('text');
  label.setAttribute('x', String(Math.max(6, x)));
  label.setAttribute('y', String(Math.max(14, y - 6)));
  label.setAttribute('fill', color);
  label.setAttribute('stroke', '#111318');
  label.setAttribute('stroke-width', '3');
  label.setAttribute('paint-order', 'stroke');
  label.setAttribute('font-size', '12');
  label.setAttribute('font-weight', '700');
  label.textContent = text;
  svg.append(label);
}

function drawInstruction(svg: SVGSVGElement, drawing: DrawingInstruction, width: number, height: number) {
  const color = COLORS[drawing.tool];
  const points = drawing.points.map((point) => ({
    x: (point.xRatio ?? 0.5) * width,
    y: point.yRatio * height,
  }));
  const first = points[0]!;
  const second = points[1];

  if (drawing.tool.endsWith('_zone') && second) {
    const rectangle = svgElement('rect');
    const top = Math.min(first.y, second.y);
    rectangle.setAttribute('x', '0'); rectangle.setAttribute('y', String(top));
    rectangle.setAttribute('width', String(width));
    rectangle.setAttribute('height', String(Math.max(3, Math.abs(second.y - first.y))));
    rectangle.setAttribute('fill', color); rectangle.setAttribute('fill-opacity', '.12');
    rectangle.setAttribute('stroke', color); rectangle.setAttribute('stroke-opacity', '.8');
    rectangle.setAttribute('stroke-dasharray', '7 5'); svg.append(rectangle);
    addLabel(svg, 8, top, drawing.label, color); return;
  }

  if (drawing.tool === 'trend_line' && second) {
    const line = svgElement('line');
    line.setAttribute('x1', String(first.x)); line.setAttribute('y1', String(first.y));
    line.setAttribute('x2', String(second.x)); line.setAttribute('y2', String(second.y));
    line.setAttribute('stroke', color); line.setAttribute('stroke-width', '2'); svg.append(line);
    addLabel(svg, second.x, second.y, drawing.label, color); return;
  }

  if (drawing.tool === 'time_marker') {
    const line = svgElement('line');
    line.setAttribute('x1', String(first.x)); line.setAttribute('x2', String(first.x));
    line.setAttribute('y1', '0'); line.setAttribute('y2', String(height));
    line.setAttribute('stroke', color); line.setAttribute('stroke-width', '1.5');
    line.setAttribute('stroke-dasharray', '6 5'); svg.append(line);
    addLabel(svg, first.x, 22, drawing.label, color); return;
  }

  if (drawing.tool === 'entry_line') {
    const shaft = svgElement('line');
    shaft.setAttribute('x1', String(first.x)); shaft.setAttribute('x2', String(first.x));
    shaft.setAttribute('y1', String(Math.min(height - 3, first.y + 34))); shaft.setAttribute('y2', String(first.y + 7));
    shaft.setAttribute('stroke', color); shaft.setAttribute('stroke-width', '4'); shaft.setAttribute('stroke-linecap', 'round'); svg.append(shaft);
    const head = svgElement('path');
    head.setAttribute('d', `M ${first.x - 9} ${first.y + 14} L ${first.x} ${first.y} L ${first.x + 9} ${first.y + 14}`);
    head.setAttribute('fill', 'none'); head.setAttribute('stroke', color); head.setAttribute('stroke-width', '4');
    head.setAttribute('stroke-linecap', 'round'); head.setAttribute('stroke-linejoin', 'round'); svg.append(head);
    addLabel(svg, first.x + 11, first.y + 25, drawing.label, color); return;
  }

  if (drawing.tool.endsWith('_marker') || drawing.tool === 'note') {
    const circle = svgElement('circle');
    circle.setAttribute('cx', String(first.x)); circle.setAttribute('cy', String(first.y));
    circle.setAttribute('r', '6'); circle.setAttribute('fill', color);
    circle.setAttribute('stroke', '#111318'); circle.setAttribute('stroke-width', '2'); svg.append(circle);
    addLabel(svg, first.x + 9, first.y, drawing.label, color); return;
  }

  const line = svgElement('line');
  line.setAttribute('x1', '0'); line.setAttribute('x2', String(width));
  line.setAttribute('y1', String(first.y)); line.setAttribute('y2', String(first.y));
  line.setAttribute('stroke', color); line.setAttribute('stroke-width', '2');
  line.setAttribute('stroke-dasharray', drawing.tool === 'stop_line' ? '7 5' : 'none');
  svg.append(line); addLabel(svg, 8, first.y, drawing.label, color);
}

export function clearTradingViewDrawings() {
  cleanupOverlay?.();
  cleanupOverlay = undefined;
  document.getElementById(OVERLAY_ID)?.remove();
}

export function renderTradingViewDrawings(drawings: DrawingInstruction[]): number {
  clearTradingViewDrawings();
  const chart = findActiveTradingViewChart();
  if (!chart) throw new Error('No visible TradingView chart was found.');
  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  Object.assign(overlay.style, { position: 'fixed', pointerEvents: 'none', zIndex: '2147483646' });
  const svg = svgElement('svg');
  svg.style.display = 'block'; overlay.append(svg); document.body.append(overlay);

  const update = () => {
    const rect = chart.getBoundingClientRect();
    Object.assign(overlay.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    svg.setAttribute('width', String(rect.width)); svg.setAttribute('height', String(rect.height));
    svg.replaceChildren();
    drawings.forEach((drawing) => drawInstruction(svg, drawing, rect.width, rect.height));
  };
  update();
  window.addEventListener('resize', update); window.addEventListener('scroll', update, true);
  cleanupOverlay = () => {
    window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); overlay.remove();
  };
  return drawings.length;
}
