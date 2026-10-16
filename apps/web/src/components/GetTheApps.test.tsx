import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GetTheApps } from './GetTheApps';

afterEach(() => vi.unstubAllGlobals());

describe('GetTheApps', () => {
  it('links each published build on the API host, without signing in', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        windows: {
          fileName: 'Offerpath_0.1.0_x64-setup.exe',
          version: '0.1.0',
          sizeBytes: 7_481_699,
          url: '/api/v1/downloads/windows',
        },
        android: {
          fileName: 'offerpath-0.1.0-2.apk',
          version: '0.1.0',
          sizeBytes: 75_253_747,
          url: '/api/v1/downloads/android',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<GetTheApps base="http://203.0.113.10:50005/api/v1" />);

    const windows = await screen.findByRole('link', { name: 'Download Offerpath for Windows' });
    expect(windows).toHaveAttribute('href', 'http://203.0.113.10:50005/api/v1/downloads/windows');
    expect(screen.getByRole('link', { name: 'Download Offerpath for Android' })).toHaveAttribute(
      'href',
      'http://203.0.113.10:50005/api/v1/downloads/android',
    );
    expect(fetchMock).toHaveBeenCalledWith('http://203.0.113.10:50005/api/v1/downloads');
  });

  it('shows nothing until a build is published', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ windows: null, android: null })),
    );

    const { container } = render(<GetTheApps base="http://203.0.113.10:50005/api/v1" />);

    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
  });
});
