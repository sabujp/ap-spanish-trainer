// Loads feature-specific HTML partials into index.html mount slots before app initialization
export async function loadHtmlPartials() {
  const slots = Array.from(document.querySelectorAll('[data-partial]'));
  if (slots.length === 0) return;

  await Promise.all(
    slots.map(async (slot) => {
      const url = slot.getAttribute('data-partial');
      if (!url) return;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Failed to load HTML partial ${url} (HTTP ${res.status})`);
      }
      const html = await res.text();
      slot.outerHTML = html;
    })
  );
}
