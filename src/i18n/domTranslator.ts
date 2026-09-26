/**
 * Translates the rendered interface in place.
 *
 * Every string in the app is written in English. Instead of threading a t()
 * call through hundreds of components, this watches the DOM and swaps UI text
 * (text nodes plus title / aria-label / placeholder / alt) for the chosen
 * language. The English original is remembered, so switching back restores
 * it and React updates (new English text) are picked up and translated again.
 *
 * User content is never touched: form fields, formulas, and anything inside
 * [data-no-translate] or [translate="no"] (tab titles, notes, search hits…).
 */
import { translate, type Language, type TranslationScope } from '../../electron/i18n';

const ATTRIBUTES = ['title', 'aria-label', 'placeholder', 'alt'] as const;
const SKIP_SELECTOR = '[data-no-translate], [translate="no"], textarea, script, style, .katex, math-field, [contenteditable="true"]';

interface Remembered {
  /** English text the app rendered. */
  source: string;
  /** What we wrote over it; if the DOM still shows this, it is ours. */
  shown: string;
}

export class DomTranslator {
  private language: Language = 'en';
  private readonly texts = new WeakMap<Text, Remembered>();
  private readonly attrs = new WeakMap<Element, Map<string, Remembered>>();
  private observer: MutationObserver | null = null;
  /** Elements whose skip state was already computed during one pass. */
  private skipCache = new WeakMap<Element, boolean>();

  constructor(private readonly root: HTMLElement) {}

  setLanguage(language: Language): void {
    if (language === this.language) return;
    this.language = language;
    this.skipCache = new WeakMap();
    this.visit(this.root);
    if (language === 'en') this.stop();
    else this.start();
  }

  dispose(): void {
    this.stop();
    if (this.language !== 'en') {
      this.language = 'en';
      this.visit(this.root);
    }
  }

  private start(): void {
    if (this.observer) return;
    this.observer = new MutationObserver((records) => this.onMutations(records));
    this.observer.observe(this.root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [...ATTRIBUTES],
    });
  }

  private stop(): void {
    this.observer?.disconnect();
    this.observer = null;
  }

  private onMutations(records: MutationRecord[]): void {
    this.skipCache = new WeakMap();
    for (const record of records) {
      if (record.type === 'childList') {
        record.addedNodes.forEach((node) => this.visit(node));
      } else if (record.type === 'characterData') {
        if (record.target instanceof Text) this.text(record.target);
      } else if (record.type === 'attributes' && record.target instanceof Element && record.attributeName) {
        this.attribute(record.target, record.attributeName);
      }
    }
  }

  private visit(node: Node): void {
    if (node instanceof Text) {
      this.text(node);
      return;
    }
    if (!(node instanceof Element)) return;
    if (this.skipped(node)) return;
    for (const name of ATTRIBUTES) if (node.hasAttribute(name)) this.attribute(node, name);
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: (current) =>
        current instanceof Element && current !== node && current.matches(SKIP_SELECTOR)
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    });
    for (let current = walker.nextNode(); current; current = walker.nextNode()) {
      if (current instanceof Text) this.text(current);
      else if (current instanceof Element) {
        for (const name of ATTRIBUTES) if (current.hasAttribute(name)) this.attribute(current, name);
      }
    }
  }

  private skipped(element: Element): boolean {
    const cached = this.skipCache.get(element);
    if (cached !== undefined) return cached;
    const result = element.closest(SKIP_SELECTOR) !== null;
    this.skipCache.set(element, result);
    return result;
  }

  private scope(element: Element): TranslationScope | undefined {
    return element.closest('[data-i18n-scope="formula"]') ? 'formula' : undefined;
  }

  private text(node: Text): void {
    const parent = node.parentElement;
    if (!parent || this.skipped(parent)) return;
    const next = this.resolve(this.texts.get(node), node.data, this.scope(parent), (value) => this.texts.set(node, value));
    if (next !== null && next !== node.data) node.data = next;
  }

  private attribute(element: Element, name: string): void {
    // Form fields keep their placeholder translated but never their value.
    if (name !== 'placeholder' && name !== 'title' && name !== 'aria-label' && name !== 'alt') return;
    if (this.skipped(element) && !(name === 'placeholder' && element.matches('textarea'))) return;
    const current = element.getAttribute(name);
    if (current === null) return;
    let map = this.attrs.get(element);
    const next = this.resolve(map?.get(name), current, this.scope(element), (value) => {
      if (!map) {
        map = new Map();
        this.attrs.set(element, map);
      }
      map.set(name, value);
    });
    if (next !== null && next !== current) element.setAttribute(name, next);
  }

  /**
   * Works out what a string should show now. Returns null when nothing needs
   * doing. `current` is what the DOM holds: either our own earlier output (then
   * the remembered English source is used) or new English from React.
   */
  private resolve(remembered: Remembered | undefined, current: string, scope: TranslationScope | undefined, remember: (value: Remembered) => void): string | null {
    const source = remembered && remembered.shown === current ? remembered.source : current;
    if (!/[A-Za-z]/.test(source)) return null;
    const shown = translate(this.language, source, scope);
    if (shown === source && !remembered) return null;
    remember({ source, shown });
    return shown;
  }
}
