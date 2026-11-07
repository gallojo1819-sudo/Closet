/**
 * A small DOM so a vitest file can mount a component and run effects.
 * Loaded before react-dom so its DOM check sees window.
 */
class NodeEl {
  nodeType: number;
  nodeName: string;
  tagName: string;
  childNodes: NodeEl[] = [];
  parentNode: NodeEl | null = null;
  attributes = new Map<string, string>();
  style: { setProperty: (name: string, value: string) => void; getPropertyValue: (name: string) => string } & Record<string, string>;
  className = "";
  listeners = new Map<string, Array<(event: EventLike) => void>>();
  ownerDocument: DomDoc | null = null;
  namespaceURI = "http://www.w3.org/1999/xhtml";
  nodeValue = "";

  constructor(name: string, nodeType = 1) {
    this.nodeType = nodeType;
    this.nodeName = String(name).toUpperCase();
    this.tagName = this.nodeName;
    const style: Record<string, string> = {};
    this.style = Object.assign(style, {
      setProperty: (name: string, value: string) => {
        style[name] = value;
      },
      getPropertyValue: (name: string) => style[name] ?? "",
    });
  }

  get textContent(): string {
    if (this.nodeType === 3 || this.nodeType === 8) return this.nodeValue;
    return this.childNodes.map((node) => node.textContent).join("");
  }

  set textContent(value: string) {
    if (this.nodeType === 3 || this.nodeType === 8) {
      this.nodeValue = String(value ?? "");
      return;
    }
    this.childNodes = [];
    if (value) this.appendChild(this.ownerDocument!.createTextNode(String(value)));
  }

  appendChild(child: NodeEl): NodeEl {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  removeChild(child: NodeEl): NodeEl {
    this.childNodes = this.childNodes.filter((node) => node !== child);
    child.parentNode = null;
    return child;
  }

  insertBefore(child: NodeEl, before: NodeEl | null): NodeEl {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    const index = before ? this.childNodes.indexOf(before) : -1;
    if (index < 0) this.childNodes.push(child);
    else this.childNodes.splice(index, 0, child);
    return child;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, String(value));
  }

  getAttribute(name: string): string | null {
    return this.attributes.has(name) ? this.attributes.get(name)! : null;
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  addEventListener(type: string, fn: (event: EventLike) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, fn: (event: EventLike) => void): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item !== fn));
  }

  click(): void {
    const path: NodeEl[] = [this];
    while (path[path.length - 1]?.parentNode) path.push(path[path.length - 1]!.parentNode!);
    const event: EventLike = {
      type: "click",
      bubbles: true,
      cancelable: true,
      target: this,
      currentTarget: null,
      timeStamp: Date.now(),
      button: 0,
      buttons: 0,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {
        this.stopped = true;
      },
      nativeEvent: null,
    };
    event.nativeEvent = event;
    for (const node of path) {
      event.currentTarget = node;
      for (const fn of [...(node.listeners.get("click") ?? [])]) fn(event);
      if (event.stopped) break;
    }
  }

  focus(): void {}
  blur(): void {}

  get firstChild(): NodeEl | null {
    return this.childNodes[0] ?? null;
  }

  contains(node: NodeEl | null): boolean {
    let current = node;
    while (current) {
      if (current === this) return true;
      current = current.parentNode;
    }
    return false;
  }

  getBoundingClientRect(): { x: number; y: number; width: number; height: number; top: number; left: number; right: number; bottom: number } {
    return { x: 0, y: 0, width: 10, height: 10, top: 0, left: 0, right: 10, bottom: 10 };
  }
}

type EventLike = {
  type: string;
  bubbles: boolean;
  cancelable: boolean;
  target: NodeEl;
  currentTarget: NodeEl | null;
  timeStamp: number;
  button: number;
  buttons: number;
  defaultPrevented: boolean;
  stopped?: boolean;
  preventDefault: () => void;
  stopPropagation: () => void;
  nativeEvent: EventLike | null;
};

type DomDoc = {
  nodeType: number;
  documentElement: NodeEl;
  body: NodeEl;
  head: NodeEl;
  activeElement: NodeEl | null;
  HTMLIFrameElement: typeof NodeEl;
  createElement: (name: string) => NodeEl;
  createElementNS: (ns: string, name: string) => NodeEl;
  createTextNode: (text: string) => NodeEl;
  createComment: (text: string) => NodeEl;
  createDocumentFragment: () => NodeEl;
  querySelector: () => null;
  querySelectorAll: () => never[];
  addEventListener: () => void;
  removeEventListener: () => void;
  hasFocus: () => boolean;
};

function element(doc: DomDoc, name: string, nodeType = 1): NodeEl {
  const node = new NodeEl(name, nodeType);
  node.ownerDocument = doc;
  return node;
}

const document = {
  nodeType: 9,
  activeElement: null,
  HTMLIFrameElement: NodeEl,
  createElement(name: string) {
    return element(document, name, 1);
  },
  createElementNS(_ns: string, name: string) {
    return document.createElement(name);
  },
  createTextNode(text: string) {
    const node = element(document, "#text", 3);
    node.nodeValue = String(text);
    return node;
  },
  createComment(text: string) {
    const node = element(document, "#comment", 8);
    node.nodeValue = String(text);
    return node;
  },
  createDocumentFragment() {
    return element(document, "#fragment", 11);
  },
  querySelector() {
    return null;
  },
  querySelectorAll() {
    return [];
  },
  addEventListener() {},
  removeEventListener() {},
  hasFocus() {
    return true;
  },
} as DomDoc;

document.documentElement = document.createElement("html");
document.body = document.createElement("body");
document.head = document.createElement("head");
document.documentElement.appendChild(document.head);
document.documentElement.appendChild(document.body);

const windowStub = {
  document,
  navigator: { userAgent: "node" },
  location: { protocol: "http:" },
  addEventListener() {},
  removeEventListener() {},
  getSelection() {
    return null;
  },
  HTMLElement: NodeEl,
  HTMLIFrameElement: NodeEl,
  Node: NodeEl,
  Element: NodeEl,
};

type Loose = Record<string, unknown> & { onsuccess?: () => void; result?: unknown };
function later(req: Loose, result: unknown): Loose {
  queueMicrotask(() => {
    req.result = result;
    req.onsuccess?.();
  });
  return req;
}
const imageStore = {
  get() {
    return later({}, undefined);
  },
  getAllKeys() {
    return later({}, []);
  },
  put() {
    return {};
  },
};
const imageDb = {
  objectStoreNames: { contains: () => true },
  transaction() {
    return { objectStore: () => imageStore };
  },
};
(globalThis as unknown as { indexedDB: { open: () => Loose } }).indexedDB = {
  open() {
    return later({}, imageDb);
  },
};

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as unknown as { window: typeof windowStub }).window = windowStub;
(globalThis as unknown as { document: DomDoc }).document = document;

export type { NodeEl };

export function hostElement(): NodeEl {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return host;
}

export function findButton(root: NodeEl, label: string): NodeEl | null {
  const walk = (node: NodeEl): NodeEl | null => {
    const aria = node.getAttribute("aria-label") ?? "";
    const text = node.nodeType === 1 ? node.childNodes.map((child) => child.textContent).join("") : "";
    if (node.nodeName === "BUTTON" && (aria === label || text.trim() === label)) return node;
    for (const child of node.childNodes) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  return walk(root);
}
