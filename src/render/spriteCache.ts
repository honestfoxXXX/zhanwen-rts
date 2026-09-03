/**
 * 精灵缓存：静态主体离屏预渲染（2 倍超采样），每帧只 drawImage。
 * key 变化（类型/阵营/损伤档）自动重绘；draw 内使用逻辑坐标。
 */
const cache = new Map<string, HTMLCanvasElement>();

export function getSprite(
  key: string,
  w: number,
  h: number,
  draw: (g: CanvasRenderingContext2D) => void,
): HTMLCanvasElement {
  let c = cache.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * 2));
    c.height = Math.max(1, Math.round(h * 2));
    const g = c.getContext('2d') as CanvasRenderingContext2D;
    g.scale(2, 2);
    draw(g);
    cache.set(key, c);
  }
  return c;
}
