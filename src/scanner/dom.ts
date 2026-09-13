import type { ScanDom } from './types';

export function collectDomStats(): ScanDom {
  const allElements = document.querySelectorAll('*');
  const scripts = Array.from(document.getElementsByTagName('script'));

  let maxDepth = 0;
  const startNode = document.documentElement;
  const visited = new Set<Element>();
  const queue: Array<{ node: Element; depth: number }> = [{ node: startNode, depth: 1 }];
  let head = 0;

  while (head < queue.length) {
    const { node, depth } = queue[head];
    head += 1;
    if (depth > maxDepth) maxDepth = depth;
    for (const child of Array.from(node.children)) {
      if (!visited.has(child)) {
        visited.add(child);
        queue.push({ node: child, depth: depth + 1 });
      }
    }
  }

  const inlineScriptCount = scripts.filter((script) => !script.getAttribute('src')).length;
  const externalScriptCount = scripts.length - inlineScriptCount;

  return {
    totalNodes: allElements.length,
    maxDepth,
    scriptTagCount: scripts.length,
    inlineScriptCount,
    externalScriptCount,
  };
}