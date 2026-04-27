import { useEffect } from "react";
import { translateUiText } from "./uiText";

const SKIP_TEXT_SELECTORS = [
  "script",
  "style",
  "textarea",
  "input",
  ".bubble",
  ".message-reactions",
  ".msg-search-mark"
].join(",");

const ATTRS = ["placeholder", "title", "aria-label"];

function shouldSkipTextNode(node) {
  const parent = node.parentElement;
  if (!parent) return true;
  return Boolean(parent.closest(SKIP_TEXT_SELECTORS));
}

function translateTextNodes(root, lang) {
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (shouldSkipTextNode(node)) return NodeFilter.FILTER_REJECT;
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  const nodes = [];
  let node;

  while ((node = walker.nextNode())) {
    nodes.push(node);
  }

  for (const textNode of nodes) {
    const next = translateUiText(textNode.nodeValue, lang);
    if (next !== textNode.nodeValue) {
      textNode.nodeValue = next;
    }
  }
}

function translateAttributes(root, lang) {
  for (const attr of ATTRS) {
    root.querySelectorAll(`[${attr}]`).forEach(el => {
      if (el.closest(".bubble")) return;

      const current = el.getAttribute(attr);
      const next = translateUiText(current, lang);

      if (next !== current) {
        el.setAttribute(attr, next);
      }
    });
  }
}

function translateDocument(lang) {
  const root = document.getElementById("root") || document.body;
  if (!root) return;

  translateTextNodes(root, lang);
  translateAttributes(root, lang);
}

export function useUiTranslator(lang) {
  useEffect(() => {
    let scheduled = false;

    const schedule = () => {
      if (scheduled) return;

      scheduled = true;

      requestAnimationFrame(() => {
        scheduled = false;
        translateDocument(lang);
      });
    };

    schedule();

    const observer = new MutationObserver(schedule);
    const root = document.getElementById("root") || document.body;

    if (root) {
      observer.observe(root, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ATTRS
      });
    }

    return () => observer.disconnect();
  }, [lang]);
}