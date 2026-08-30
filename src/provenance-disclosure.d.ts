export function createProvenanceDisclosure(options: {
  root: HTMLElement;
  trigger: HTMLButtonElement;
  panel: HTMLElement;
  ownerDocument: Document;
}): { destroy(): void };
