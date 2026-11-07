/**
 * Partner Apps grid rendering.
 *
 * Pins the card contract the dashboard page relies on: catalog order
 * is preserved, category badges read "PG app" / "Affiliated", Visit
 * links open the app URL in a new tab with safe rel attributes, apps
 * with a logoUrl render the logo while the rest get a monogram tile,
 * and an empty catalog renders a clean empty state.
 *
 * Rendered with react-dom/server (the repo has no @testing-library/dom
 * installed for @testing-library/react) and asserted against the
 * parsed static markup in the jsdom document.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import PartnerAppsGrid from './partner-apps-grid';
import type { PartnerApp } from '@/lib/partner-apps/partner-apps';

const app = (overrides: Partial<PartnerApp>): PartnerApp => ({
  name: 'Example',
  tagline: 'An example app.',
  url: 'https://example.com',
  logoUrl: null,
  category: 'pg',
  ...overrides,
});

function renderGrid(apps: PartnerApp[]): HTMLElement {
  const container = document.createElement('div');
  container.innerHTML = renderToStaticMarkup(<PartnerAppsGrid apps={apps} />);
  return container;
}

describe('PartnerAppsGrid', () => {
  it('renders cards in the given order', () => {
    const container = renderGrid([
      app({ name: 'Zeta', url: 'https://zeta.example.com' }),
      app({ name: 'Alpha', url: 'https://alpha.example.com' }),
    ]);

    const headings = Array.from(container.querySelectorAll('h2')).map(
      (h) => h.textContent,
    );
    expect(headings).toEqual(['Zeta', 'Alpha']);
  });

  it('labels PG apps and affiliated apps with their badges', () => {
    const container = renderGrid([
      app({ name: 'Hub App', url: 'https://hub.example.com', category: 'pg' }),
      app({ name: 'Partner Co', url: 'https://partner.example.com', category: 'affiliated' }),
    ]);

    expect(container.textContent).toContain('PG app');
    expect(container.textContent).toContain('Affiliated');
  });

  it('renders Visit links that open the app URL safely in a new tab', () => {
    const container = renderGrid([
      app({ name: 'Zeta', url: 'https://zeta.example.com' }),
    ]);

    const link = container.querySelector('a');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('https://zeta.example.com');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toContain('noopener');
    expect(link?.getAttribute('rel')).toContain('noreferrer');
    expect(link?.textContent).toContain('Visit');
  });

  it('renders the logo image when logoUrl is set, a monogram otherwise', () => {
    const container = renderGrid([
      app({
        name: 'Logo App',
        url: 'https://logo.example.com',
        logoUrl: 'https://logo.example.com/logo.png',
      }),
      app({ name: 'ID Verification Hub', url: 'https://idv.example.com' }),
    ]);

    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe('https://logo.example.com/logo.png');
    expect(container.textContent).toContain('IV');
  });

  it('renders a clean empty state for an empty catalog', () => {
    const container = renderGrid([]);

    expect(container.textContent).toContain('No partner apps yet');
    expect(container.querySelector('a')).toBeNull();
  });
});
