import DOMPurify from 'dompurify';

/** Sanitize in the destination's parsing context, preserving table and SVG children. */
export function setHTML(element: Element, value: unknown): void {
  const staging = element.cloneNode(false) as Element;
  staging.innerHTML = String(value ?? '');
  DOMPurify.sanitize(staging, { IN_PLACE: true, ADD_ATTR: ['target'], FORBID_TAGS: ['script', 'iframe', 'object', 'embed'] });
  for (const link of staging.querySelectorAll('a[target="_blank"]')) link.setAttribute('rel', 'noopener noreferrer');
  // Moving options out of a select can change their selectedness as its children disappear.
  const selected = staging.tagName === 'SELECT' ? Array.from((staging as HTMLSelectElement).options, option => option.selected) : null;
  element.replaceChildren(...Array.from(staging.childNodes));
  if (selected) Array.from((element as HTMLSelectElement).options).forEach((option, index) => { option.selected = selected[index]; });
}

export function insertHTML(element: Element, position: InsertPosition, value: string): void {
  const staging = element.ownerDocument.createElement('div');
  setHTML(staging, value);
  const fragment = element.ownerDocument.createDocumentFragment();
  fragment.append(...Array.from(staging.childNodes));
  switch (position.toLowerCase()) {
    case 'beforebegin': element.before(fragment); break;
    case 'afterend': element.after(fragment); break;
    case 'afterbegin': element.prepend(fragment); break;
    case 'beforeend': element.append(fragment); break;
    default: throw new Error('Invalid insertion position');
  }
}

export function escapeHTML(value: unknown = ''): string {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}
